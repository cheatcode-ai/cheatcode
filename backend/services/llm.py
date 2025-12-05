"""
LLM API interface for making calls to various language models.

This module provides a unified interface for making API calls to different LLM providers
(OpenAI, Anthropic, Groq, etc.) using LiteLLM and direct APIs. It includes support for:
- Streaming responses
- Tool calls and function calling
- Retry logic with exponential backoff
- Model-specific configurations
- Comprehensive error handling and logging
- Direct Google Gemini API integration
"""

from typing import Union, Dict, Any, Optional, AsyncGenerator, List
import os
import json
import asyncio
from openai import OpenAIError
import litellm
from litellm import Router
from utils.logger import logger
from utils.config import config
from utils.models import (
    get_router_model_list as _get_router_model_list_from_models,
    get_router_model_name as _get_router_model_name_from_models,
)

# litellm.set_verbose=True
litellm.modify_params=True

# Constants
MAX_RETRIES = 2
RATE_LIMIT_DELAY = 30
RETRY_DELAY = 0.1
LLM_CALL_TIMEOUT = 120  # 2 minute timeout for LLM API calls

# Circuit breaker constants
CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5  # Failures before opening circuit
CIRCUIT_BREAKER_RECOVERY_TIMEOUT = 60  # Seconds before attempting recovery
CIRCUIT_BREAKER_HALF_OPEN_CALLS = 2    # Test calls allowed in half-open state


# ============================================================================
# Circuit Breaker Pattern for Provider Outages
# ============================================================================

class CircuitBreakerState:
    """Enum-like class for circuit breaker states."""
    CLOSED = "closed"       # Normal operation, calls allowed
    OPEN = "open"           # Circuit tripped, calls blocked
    HALF_OPEN = "half_open" # Testing if service recovered


class CircuitBreaker:
    """
    Circuit breaker pattern to prevent cascading failures during provider outages.

    States:
    - CLOSED: Normal operation, all calls pass through
    - OPEN: Service is failing, calls are rejected immediately
    - HALF_OPEN: Testing if service has recovered

    Transitions:
    - CLOSED -> OPEN: After failure_threshold consecutive failures
    - OPEN -> HALF_OPEN: After recovery_timeout seconds
    - HALF_OPEN -> CLOSED: After successful test calls
    - HALF_OPEN -> OPEN: If test call fails
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        recovery_timeout: float = CIRCUIT_BREAKER_RECOVERY_TIMEOUT,
        half_open_calls: int = CIRCUIT_BREAKER_HALF_OPEN_CALLS
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_calls = half_open_calls

        self.state = CircuitBreakerState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time: Optional[float] = None
        self._lock = asyncio.Lock()

    async def can_execute(self) -> bool:
        """Check if a call should be allowed through the circuit breaker."""
        async with self._lock:
            if self.state == CircuitBreakerState.CLOSED:
                return True

            if self.state == CircuitBreakerState.OPEN:
                # Check if recovery timeout has passed
                if self.last_failure_time:
                    import time
                    elapsed = time.monotonic() - self.last_failure_time
                    if elapsed >= self.recovery_timeout:
                        logger.info(f"Circuit breaker '{self.name}' transitioning to HALF_OPEN after {elapsed:.1f}s")
                        self.state = CircuitBreakerState.HALF_OPEN
                        self.success_count = 0
                        return True
                return False

            if self.state == CircuitBreakerState.HALF_OPEN:
                # Allow limited test calls
                return self.success_count < self.half_open_calls

            return False

    async def record_success(self) -> None:
        """Record a successful call."""
        async with self._lock:
            if self.state == CircuitBreakerState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.half_open_calls:
                    logger.info(f"Circuit breaker '{self.name}' transitioning to CLOSED after {self.success_count} successful calls")
                    self.state = CircuitBreakerState.CLOSED
                    self.failure_count = 0
                    self.success_count = 0
            elif self.state == CircuitBreakerState.CLOSED:
                # Reset failure count on success
                self.failure_count = 0

    async def record_failure(self) -> None:
        """Record a failed call."""
        import time
        async with self._lock:
            self.failure_count += 1
            self.last_failure_time = time.monotonic()

            if self.state == CircuitBreakerState.HALF_OPEN:
                # Any failure in half-open reopens the circuit
                logger.warning(f"Circuit breaker '{self.name}' reopening after failure in HALF_OPEN state")
                self.state = CircuitBreakerState.OPEN

            elif self.state == CircuitBreakerState.CLOSED:
                if self.failure_count >= self.failure_threshold:
                    logger.error(f"Circuit breaker '{self.name}' OPENED after {self.failure_count} consecutive failures")
                    self.state = CircuitBreakerState.OPEN

    def get_state(self) -> Dict[str, Any]:
        """Get current circuit breaker state for monitoring."""
        return {
            "name": self.name,
            "state": self.state,
            "failure_count": self.failure_count,
            "success_count": self.success_count,
            "last_failure_time": self.last_failure_time
        }


class CircuitBreakerOpenError(Exception):
    """Exception raised when circuit breaker is open."""
    def __init__(self, name: str, recovery_in: float):
        self.name = name
        self.recovery_in = recovery_in
        super().__init__(f"Circuit breaker '{name}' is OPEN. Recovery in {recovery_in:.1f}s")


# Global circuit breakers per provider
_circuit_breakers: Dict[str, CircuitBreaker] = {}


def get_circuit_breaker(provider: str) -> CircuitBreaker:
    """Get or create a circuit breaker for a provider."""
    if provider not in _circuit_breakers:
        _circuit_breakers[provider] = CircuitBreaker(name=provider)
        logger.debug(f"Created circuit breaker for provider: {provider}")
    return _circuit_breakers[provider]


def get_provider_from_model(model_name: str) -> str:
    """Extract provider name from model name for circuit breaker tracking."""
    if model_name.startswith("openrouter/"):
        # For OpenRouter, track by the underlying provider
        parts = model_name.split("/")
        if len(parts) >= 3:
            return f"openrouter/{parts[1]}"  # e.g., "openrouter/anthropic"
        return "openrouter"
    elif model_name.startswith("bedrock/"):
        return "bedrock"
    elif "claude" in model_name.lower() or "anthropic" in model_name.lower():
        return "anthropic"
    elif "gpt" in model_name.lower() or "openai" in model_name.lower():
        return "openai"
    elif "gemini" in model_name.lower() or "google" in model_name.lower():
        return "google"
    return "default"


# ============================================================================
# LiteLLM Router Configuration for Model Fallbacks
# ============================================================================

def get_router_model_list() -> List[Dict[str, Any]]:
    """
    Get the model list for LiteLLM Router.

    This is now generated from the single source of truth in utils/models.py.
    """
    openrouter_key = config.OPENROUTER_API_KEY
    if not openrouter_key:
        logger.warning("OPENROUTER_API_KEY not set - router will use direct calls")
        return []

    return _get_router_model_list_from_models(openrouter_key)


def create_llm_router() -> Optional[Router]:
    """
    Create a LiteLLM Router instance with fallback configuration.

    The router provides:
    - Automatic model fallbacks on errors
    - Retry logic with configurable attempts
    - Timeout handling
    - TPM/RPM tracking (optional)
    """
    model_list = get_router_model_list()

    if not model_list:
        logger.info("No router model list configured - using direct LiteLLM calls")
        return None

    try:
        router = Router(
            model_list=model_list,
            num_retries=MAX_RETRIES,
            timeout=LLM_CALL_TIMEOUT,
            retry_after=RETRY_DELAY,
            fallbacks=[
                # Define explicit fallback chains
                {"claude-sonnet": ["claude-sonnet"]},
                {"gemini-pro": ["gemini-pro"]},
                {"gemini-flash": ["gemini-flash"]},
                {"kimi-k2": ["kimi-k2"]},
            ],
            routing_strategy="simple-shuffle",
            set_verbose=False,
        )
        logger.info(f"LiteLLM Router initialized with {len(model_list)} model configurations")
        return router
    except Exception as e:
        logger.error(f"Failed to create LiteLLM Router: {str(e)}")
        return None


# Global router instance (lazy initialized)
_llm_router: Optional[Router] = None


def get_llm_router() -> Optional[Router]:
    """Get or create the global LLM router instance."""
    global _llm_router
    if _llm_router is None:
        _llm_router = create_llm_router()
    return _llm_router


def get_router_model_name(model_name: str) -> Optional[str]:
    """
    Map an OpenRouter model ID to the router group name (short ID).

    This is now generated from the single source of truth in utils/models.py.
    """
    return _get_router_model_name_from_models(model_name)

class LLMError(Exception):
    """Base exception for LLM-related errors."""
    pass

class LLMRetryError(LLMError):
    """Exception raised when retries are exhausted."""
    pass

def setup_api_keys() -> None:
    """Set up API keys from environment variables."""
    providers = ['OPENAI', 'ANTHROPIC', 'OPENROUTER']
    for provider in providers:
        key = getattr(config, f'{provider}_API_KEY')
        if key:
            logger.debug(f"API key set for provider: {provider}")
        else:
            logger.warning(f"No API key found for provider: {provider}")

    # Set up OpenRouter API base if not already set
    if config.OPENROUTER_API_KEY and config.OPENROUTER_API_BASE:
        os.environ['OPENROUTER_API_BASE'] = config.OPENROUTER_API_BASE
        logger.debug(f"Set OPENROUTER_API_BASE to {config.OPENROUTER_API_BASE}")

def should_use_direct_gemini(model_name: str) -> bool:
    """Determine if we should use direct Gemini API instead of LiteLLM."""
    # DISABLED: Always use LiteLLM/OpenRouter for Gemini models
    return False
    # return model_name.startswith("gemini-direct/") or model_name in [
    #     "gemini-2.5-flash",
    #     "gemini-2.5-pro", 
    #     "gemini-2.5-flash-thinking",
    #     "gemini-2.5-pro-thinking"
    # ]

async def handle_error(error: Exception, attempt: int, max_attempts: int) -> None:
    """Handle API errors with exponential backoff and jitter."""
    import random

    if isinstance(error, litellm.exceptions.RateLimitError):
        # For rate limits, use longer exponential backoff
        base_delay = 5.0
        max_delay = 60.0
        delay = min(base_delay * (2 ** attempt), max_delay) + random.uniform(0, 2)
    else:
        # For other errors, use shorter exponential backoff
        base_delay = RETRY_DELAY
        max_delay = 5.0
        delay = min(base_delay * (2 ** attempt), max_delay) + random.uniform(0, 0.5)

    logger.warning(f"Error on attempt {attempt + 1}/{max_attempts}: {str(error)}")
    logger.debug(f"Waiting {delay:.2f} seconds before retry (exponential backoff)...")
    await asyncio.sleep(delay)

def prepare_params(
    messages: List[Dict[str, Any]],
    model_name: str,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
    response_format: Optional[Any] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: str = "auto",
    api_key: Optional[str] = None,
    api_base: Optional[str] = None,
    stream: bool = False,
    top_p: Optional[float] = None,
    model_id: Optional[str] = None,
    enable_thinking: Optional[bool] = False,
    reasoning_effort: Optional[str] = 'low'
) -> Dict[str, Any]:
    """Prepare parameters for the API call."""
    params = {
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "response_format": response_format,
        "top_p": top_p,
        "stream": stream,
    }

    if api_key:
        params["api_key"] = api_key
    if api_base:
        params["api_base"] = api_base
    if model_id:
        params["model_id"] = model_id

    # Handle token limits
    if max_tokens is not None:
        # For Claude 3.7 in Bedrock, do not set max_tokens or max_tokens_to_sample
        # as it causes errors with inference profiles
        if model_name.startswith("bedrock/") and "claude-3-7" in model_name:
            logger.debug(f"Skipping max_tokens for Claude 3.7 model: {model_name}")
            # Do not add any max_tokens parameter for Claude 3.7
        else:
            param_name = "max_completion_tokens" if 'o1' in model_name else "max_tokens"
            params[param_name] = max_tokens

    # Add tools if provided
    if tools:
        params.update({
            "tools": tools,
            "tool_choice": tool_choice
        })
        logger.debug(f"Added {len(tools)} tools to API parameters")

    # # Add Claude-specific headers
    if "claude" in model_name.lower() or "anthropic" in model_name.lower():
        params["extra_headers"] = {
            # "anthropic-beta": "max-tokens-3-5-sonnet-2024-07-15"
            "anthropic-beta": "output-128k-2025-02-19"
        }
        params["fallbacks"] = [{
            "model": "openrouter/anthropic/claude-sonnet-4.5",
            "messages": messages,
        }]
        # params["mock_testing_fallback"] = True
        logger.debug("Added Claude-specific headers")

    # Add OpenRouter-specific parameters
    if model_name.startswith("openrouter/"):
        logger.debug(f"Preparing OpenRouter parameters for model: {model_name}")

        # Add optional site URL and app name from config
        site_url = config.OR_SITE_URL
        app_name = config.OR_APP_NAME
        if site_url or app_name:
            extra_headers = params.get("extra_headers", {})
            if site_url:
                extra_headers["HTTP-Referer"] = site_url
            if app_name:
                extra_headers["X-Title"] = app_name
            params["extra_headers"] = extra_headers
            logger.debug(f"Added OpenRouter site URL and app name to headers")

    # Add Bedrock-specific parameters
    if model_name.startswith("bedrock/"):
        logger.debug(f"Preparing AWS Bedrock parameters for model: {model_name}")

        if not model_id and "anthropic.claude-3-7-sonnet" in model_name:
            params["model_id"] = "arn:aws:bedrock:us-west-2:935064898258:inference-profile/us.anthropic.claude-3-7-sonnet-20250219-v1:0"
            logger.debug(f"Auto-set model_id for Claude 3.7 Sonnet: {params['model_id']}")

    # Apply Anthropic prompt caching (minimal implementation)
    # Check model name *after* potential modifications (like adding bedrock/ prefix)
    effective_model_name = params.get("model", model_name) # Use model from params if set, else original
    if "claude" in effective_model_name.lower() or "anthropic" in effective_model_name.lower():
        messages = params["messages"] # Direct reference, modification affects params

        # Ensure messages is a list
        if not isinstance(messages, list):
            return params # Return early if messages format is unexpected

        # Apply cache control to the first 4 text blocks across all messages
        cache_control_count = 0
        max_cache_control_blocks = 4

        for message in messages:
            if cache_control_count >= max_cache_control_blocks:
                break
                
            content = message.get("content")
            
            if isinstance(content, str):
                message["content"] = [
                    {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
                ]
                cache_control_count += 1
            elif isinstance(content, list):
                for item in content:
                    if cache_control_count >= max_cache_control_blocks:
                        break
                    if isinstance(item, dict) and item.get("type") == "text" and "cache_control" not in item:
                        item["cache_control"] = {"type": "ephemeral"}
                        cache_control_count += 1

    # Add reasoning_effort for Anthropic models if enabled
    use_thinking = enable_thinking if enable_thinking is not None else False
    is_anthropic = "anthropic" in effective_model_name.lower() or "claude" in effective_model_name.lower()

    if is_anthropic and use_thinking:
        effort_level = reasoning_effort if reasoning_effort else 'low'
        params["reasoning_effort"] = effort_level
        params["temperature"] = 1.0 # Required by Anthropic when reasoning_effort is used
        logger.info(f"Anthropic thinking enabled with reasoning_effort='{effort_level}'")

    return params

async def make_llm_api_call(
    messages: List[Dict[str, Any]],
    model_name: str,
    response_format: Optional[Any] = None,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: str = "auto",
    api_key: Optional[str] = None,
    api_base: Optional[str] = None,
    stream: bool = False,
    top_p: Optional[float] = None,
    model_id: Optional[str] = None,
    enable_thinking: Optional[bool] = False,
    reasoning_effort: Optional[str] = 'low'
) -> Union[Dict[str, Any], AsyncGenerator]:
    """
    Make an API call to a language model using LiteLLM or direct APIs.

    Args:
        messages: List of message dictionaries for the conversation
        model_name: Name of the model to use (e.g., "gpt-4", "claude-3", "openrouter/openai/gpt-4", "bedrock/anthropic.claude-3-sonnet-20240229-v1:0", "gemini-2.5-flash")
        response_format: Desired format for the response
        temperature: Sampling temperature (0-1)
        max_tokens: Maximum tokens in the response
        tools: List of tool definitions for function calling
        tool_choice: How to select tools ("auto" or "none")
        api_key: Override default API key
        api_base: Override default API base URL
        stream: Whether to stream the response
        top_p: Top-p sampling parameter
        model_id: Optional ARN for Bedrock inference profiles
        enable_thinking: Whether to enable thinking
        reasoning_effort: Level of reasoning effort

    Returns:
        Union[Dict[str, Any], AsyncGenerator]: API response or stream

    Raises:
        LLMRetryError: If API call fails after retries
        LLMError: For other API-related errors
    """
    logger.info(f"Making LLM API call to model: {model_name} (Thinking: {enable_thinking}, Effort: {reasoning_effort})")
    logger.info(f"📡 API Call: Using model {model_name}")

    # =========================================================================
    # Circuit Breaker Check
    # =========================================================================
    provider = get_provider_from_model(model_name)
    circuit_breaker = get_circuit_breaker(provider)

    if not await circuit_breaker.can_execute():
        import time
        elapsed = time.monotonic() - (circuit_breaker.last_failure_time or 0)
        recovery_in = max(0, circuit_breaker.recovery_timeout - elapsed)
        logger.warning(f"Circuit breaker OPEN for {provider}. Rejecting call. Recovery in {recovery_in:.1f}s")
        raise CircuitBreakerOpenError(provider, recovery_in)

    # Direct Gemini API routing is DISABLED - always use LiteLLM/OpenRouter
    # if should_use_direct_gemini(model_name):
    #     logger.info(f"🔗 Routing to direct Gemini API for model: {model_name}")
    #     try:
    #         from services.gemini import make_gemini_api_call
    #         ...
    #     except Exception as e:
    #         logger.error(f"Direct Gemini API call failed: {str(e)}")
    #         logger.info("Falling back to LiteLLM for Gemini model")
    
    # Use LiteLLM for all other models
    params = prepare_params(
        messages=messages,
        model_name=model_name,
        temperature=temperature,
        max_tokens=max_tokens,
        response_format=response_format,
        tools=tools,
        tool_choice=tool_choice,
        api_key=api_key,
        api_base=api_base,
        stream=stream,
        top_p=top_p,
        model_id=model_id,
        enable_thinking=enable_thinking,
        reasoning_effort=reasoning_effort
    )

    # =========================================================================
    # Try using LiteLLM Router for automatic fallbacks (if configured)
    # =========================================================================
    router = get_llm_router()
    router_model = get_router_model_name(model_name) if router else None

    if router and router_model and not api_key:
        # Use router for automatic fallbacks (only if not using custom API key)
        logger.info(f"🔄 Using LiteLLM Router for model group: {router_model}")
        try:
            # Prepare router params (router handles retries internally)
            router_params = {
                "model": router_model,
                "messages": messages,
                "temperature": temperature,
                "stream": stream,
            }
            if max_tokens:
                router_params["max_tokens"] = max_tokens
            if tools:
                router_params["tools"] = tools
                router_params["tool_choice"] = tool_choice
            if top_p:
                router_params["top_p"] = top_p
            if response_format:
                router_params["response_format"] = response_format

            response = await asyncio.wait_for(
                router.acompletion(**router_params),
                timeout=LLM_CALL_TIMEOUT
            )
            logger.debug(f"Successfully received API response via router for {router_model}")
            await circuit_breaker.record_success()  # Record success with circuit breaker
            return response

        except Exception as router_error:
            logger.warning(f"Router call failed for {router_model}: {str(router_error)}. Falling back to direct call.")
            await circuit_breaker.record_failure()  # Record failure (but continue to fallback)
            # Fall through to direct LiteLLM call

    # =========================================================================
    # Direct LiteLLM call with manual retry loop (fallback or non-router models)
    # =========================================================================
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            logger.debug(f"Attempt {attempt + 1}/{MAX_RETRIES}")
            # logger.debug(f"API request parameters: {json.dumps(params, indent=2)}")

            # Add timeout to prevent indefinite hangs
            response = await asyncio.wait_for(
                litellm.acompletion(**params),
                timeout=LLM_CALL_TIMEOUT
            )
            logger.debug(f"Successfully received API response from {model_name}")
            await circuit_breaker.record_success()  # Record success with circuit breaker
            return response

        except asyncio.TimeoutError as e:
            last_error = e
            logger.warning(f"LLM API call timed out after {LLM_CALL_TIMEOUT}s on attempt {attempt + 1}/{MAX_RETRIES}")
            await circuit_breaker.record_failure()  # Record timeout as failure
            await handle_error(e, attempt, MAX_RETRIES)

        except (litellm.exceptions.RateLimitError, OpenAIError, json.JSONDecodeError) as e:
            last_error = e
            await circuit_breaker.record_failure()  # Record API error as failure
            await handle_error(e, attempt, MAX_RETRIES)

        except Exception as e:
            logger.error(f"Unexpected error during API call: {str(e)}", exc_info=True)
            # Enhanced error handling for OpenRouter-specific errors based on official documentation
            error_msg = str(e)
            
            # Try to extract HTTP status code from error
            status_code = None
            if hasattr(e, 'status_code'):
                status_code = e.status_code
            elif hasattr(e, 'response') and hasattr(e.response, 'status_code'):
                status_code = e.response.status_code
            elif "400" in error_msg:
                status_code = 400
            elif "401" in error_msg:
                status_code = 401
            elif "402" in error_msg:
                status_code = 402
            elif "403" in error_msg:
                status_code = 403
            elif "408" in error_msg:
                status_code = 408
            elif "429" in error_msg:
                status_code = 429
            elif "502" in error_msg:
                status_code = 502
            elif "503" in error_msg:
                status_code = 503
            
            # Map OpenRouter status codes to user-friendly messages
            if status_code == 400:
                raise LLMError("Bad request to OpenRouter API. Please check your request parameters.")
            elif status_code == 401:
                raise LLMError("Invalid OpenRouter API key or expired session. Please check your API key in settings.")
            elif status_code == 402:
                raise LLMError("Insufficient credits in your OpenRouter account. Please add more credits and try again.")
            elif status_code == 403:
                raise LLMError("Your input was flagged by content moderation. Please modify your request and try again.")
            elif status_code == 408:
                raise LLMError("Request timed out. Please try again or consider using a different model.")
            elif status_code == 429:
                raise LLMError("Rate limit exceeded on your OpenRouter account. Please wait a moment and try again.")
            elif status_code == 502:
                raise LLMError("The selected model is currently down or returned an invalid response. Please try a different model.")
            elif status_code == 503:
                raise LLMError("No model provider available that meets your requirements. Please try a different model.")
            
            # Fallback to content-based error detection for older error formats
            elif "insufficient" in error_msg.lower() and "credit" in error_msg.lower():
                raise LLMError("Insufficient credits in your OpenRouter account. Please add credits and try again.")
            elif "invalid" in error_msg.lower() and ("key" in error_msg.lower() or "token" in error_msg.lower()):
                raise LLMError("Invalid OpenRouter API key. Please check your API key in settings.")
            elif "rate limit" in error_msg.lower():
                raise LLMError("Rate limit exceeded on your OpenRouter account. Please try again later.")
            elif "model" in error_msg.lower() and ("not found" in error_msg.lower() or "unavailable" in error_msg.lower()):
                raise LLMError("The requested model is not available with your OpenRouter account.")
            elif "moderation" in error_msg.lower() or "flagged" in error_msg.lower():
                raise LLMError("Your input was flagged by content moderation. Please modify your request and try again.")
            else:
                raise LLMError(f"OpenRouter API error: {error_msg}")

    error_msg = f"Failed to make API call after {MAX_RETRIES} attempts"
    if last_error:
        error_msg += f". Last error: {str(last_error)}"
    logger.error(error_msg, exc_info=True)
    raise LLMRetryError(error_msg)

# Initialize API keys on module import
setup_api_keys()
