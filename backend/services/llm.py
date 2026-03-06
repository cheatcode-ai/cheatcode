"""LLM API interface for making calls to various language models.

This module provides a unified interface for making API calls to different LLM providers
(OpenAI, Anthropic, Groq, etc.) using LiteLLM and direct APIs. It includes support for:
- Streaming responses
- Tool calls and function calling
- Native LiteLLM Router retry/cooldown policies
- Model-specific configurations
- Typed exception mapping for user-friendly errors
"""

import asyncio
import hashlib
import hmac
import os
from collections.abc import AsyncGenerator
from typing import Any

import litellm
from litellm import Router
from litellm.router import AllowedFailsPolicy, RetryPolicy

from utils.config import config
from utils.logger import logger
from utils.models import (
    get_router_model_list as _get_router_model_list_from_models,
)
from utils.models import (
    get_router_model_name as _get_router_model_name_from_models,
)

# litellm.set_verbose=True
litellm.modify_params = True

# Automatic Langfuse logging for all LLM calls via LiteLLM callbacks
if config.LANGFUSE_PUBLIC_KEY and config.LANGFUSE_SECRET_KEY:
    if not hasattr(litellm, "callbacks") or litellm.callbacks is None:
        litellm.callbacks = []
    if "langfuse" not in litellm.callbacks:
        litellm.callbacks.append("langfuse")

# Constants
MAX_RETRIES = 2
RETRY_DELAY = 0.1
LLM_CALL_TIMEOUT = 120  # 2 minute timeout for LLM API calls


# ============================================================================
# LiteLLM Router Configuration with Native Retry/Cooldown Policies
# ============================================================================


def get_router_model_list() -> list[dict[str, Any]]:
    """Get the model list for LiteLLM Router.

    This is now generated from the single source of truth in utils/models.py.
    """
    openrouter_key = config.OPENROUTER_API_KEY
    if not openrouter_key:
        logger.warning("OPENROUTER_API_KEY not set - router will use direct calls")
        return []

    return _get_router_model_list_from_models(openrouter_key)


def create_llm_router() -> Router | None:
    """Create a LiteLLM Router instance with native retry and cooldown policies.

    The router provides:
    - Per-exception-type retry counts
    - Per-exception-type cooldown thresholds
    - Automatic cooldown of failing deployments
    - Same-model retry (no cross-model fallbacks)
    """
    model_list = get_router_model_list()

    if not model_list:
        logger.info("No router model list configured - using direct LiteLLM calls")
        return None

    retry_policy = RetryPolicy(
        BadRequestErrorRetries=0,
        AuthenticationErrorRetries=0,
        TimeoutErrorRetries=2,
        RateLimitErrorRetries=3,
        ContentPolicyViolationErrorRetries=0,
        InternalServerErrorRetries=2,
    )

    allowed_fails_policy = AllowedFailsPolicy(
        BadRequestErrorAllowedFails=10,
        AuthenticationErrorAllowedFails=1,
        TimeoutErrorAllowedFails=5,
        RateLimitErrorAllowedFails=3,
        ContentPolicyViolationErrorAllowedFails=1000,
        InternalServerErrorAllowedFails=5,
    )

    try:
        router = Router(
            model_list=model_list,
            num_retries=MAX_RETRIES,
            timeout=LLM_CALL_TIMEOUT,
            retry_after=RETRY_DELAY,
            cooldown_time=60.0,
            allowed_fails=5,
            retry_policy=retry_policy,
            allowed_fails_policy=allowed_fails_policy,
            routing_strategy="simple-shuffle",
            set_verbose=False,
        )
        logger.info(f"LiteLLM Router initialized with {len(model_list)} model configurations")
        return router
    except Exception as e:
        logger.error(f"Failed to create LiteLLM Router: {e!s}")
        return None


# Global router instance (lazy initialized)
_llm_router: Router | None = None


def get_llm_router() -> Router | None:
    """Get or create the global LLM router instance."""
    global _llm_router
    if _llm_router is None:
        _llm_router = create_llm_router()
    return _llm_router


def get_router_model_name(model_name: str) -> str | None:
    """Map an OpenRouter model ID to the router group name (short ID).

    This is now generated from the single source of truth in utils/models.py.
    """
    return _get_router_model_name_from_models(model_name)


class LLMError(Exception):
    """Base exception for LLM-related errors."""


class LLMRetryError(LLMError):
    """Exception raised when retries are exhausted."""


def setup_api_keys() -> None:
    """Set up API keys from environment variables."""
    providers = ["OPENAI", "ANTHROPIC", "OPENROUTER"]
    for provider in providers:
        key = getattr(config, f"{provider}_API_KEY")
        if key:
            logger.debug(f"API key set for provider: {provider}")
        else:
            logger.warning(f"No API key found for provider: {provider}")

    # Set up OpenRouter API base if not already set
    if config.OPENROUTER_API_KEY and config.OPENROUTER_API_BASE:
        os.environ["OPENROUTER_API_BASE"] = config.OPENROUTER_API_BASE
        logger.debug(f"Set OPENROUTER_API_BASE to {config.OPENROUTER_API_BASE}")

    # LiteLLM reads these env vars and auto-injects headers for openrouter/ models
    if config.OR_SITE_URL:
        os.environ["OR_SITE_URL"] = config.OR_SITE_URL
    if config.OR_APP_NAME:
        os.environ["OR_APP_NAME"] = config.OR_APP_NAME


def prepare_params(
    messages: list[dict[str, Any]],
    model_name: str,
    temperature: float = 0,
    max_tokens: int | None = None,
    response_format: Any | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str = "auto",
    api_key: str | None = None,
    api_base: str | None = None,
    stream: bool = False,
    top_p: float | None = None,
    model_id: str | None = None,
    enable_thinking: bool | None = False,
    reasoning_effort: str | None = "low",
) -> dict[str, Any]:
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
            param_name = "max_completion_tokens" if "o1" in model_name else "max_tokens"
            params[param_name] = max_tokens

    # Add tools if provided
    if tools:
        params.update({"tools": tools, "tool_choice": tool_choice})
        logger.debug(f"Added {len(tools)} tools to API parameters")

    # Add Claude-specific headers
    if "claude" in model_name.lower() or "anthropic" in model_name.lower():
        params["extra_headers"] = {"anthropic-beta": "output-128k-2025-02-19"}
        logger.debug("Added Claude-specific headers")

    # Add OpenRouter-specific parameters: response healing + provider routing
    if model_name.startswith("openrouter/"):
        logger.debug(f"Preparing OpenRouter parameters for model: {model_name}")
        extra_body = params.get("extra_body", {})
        extra_body["plugins"] = [{"id": "response-healing"}]
        extra_body["provider"] = {
            "sort": "latency",  # Route to fastest provider
            "allow_fallbacks": True,  # Provider-level failover (same model, different host)
            "require_parameters": True,  # Only providers supporting all params
            "data_collection": "deny",  # Protect user code privacy
        }
        params["extra_body"] = extra_body

    # Add Bedrock-specific parameters
    if model_name.startswith("bedrock/"):
        logger.debug(f"Preparing AWS Bedrock parameters for model: {model_name}")

        if not model_id and "anthropic.claude-3-7-sonnet" in model_name:
            params["model_id"] = (
                "arn:aws:bedrock:us-west-2:935064898258:inference-profile/us.anthropic.claude-3-7-sonnet-20250219-v1:0"
            )
            logger.debug(f"Auto-set model_id for Claude 3.7 Sonnet: {params['model_id']}")

    # Apply Anthropic prompt caching with 1-hour TTL
    # Check model name *after* potential modifications (like adding bedrock/ prefix)
    effective_model_name = params.get("model", model_name)  # Use model from params if set, else original
    if "claude" in effective_model_name.lower() or "anthropic" in effective_model_name.lower():
        messages = params["messages"]  # Direct reference, modification affects params

        # Ensure messages is a list
        if not isinstance(messages, list):
            return params  # Return early if messages format is unexpected

        # Apply cache control to the first 4 text blocks across all messages
        cache_control_count = 0
        max_cache_control_blocks = 4

        for message in messages:
            if cache_control_count >= max_cache_control_blocks:
                break

            content = message.get("content")

            if isinstance(content, str):
                message["content"] = [
                    {"type": "text", "text": content, "cache_control": {"type": "ephemeral", "ttl": "1h"}}
                ]
                cache_control_count += 1
            elif isinstance(content, list):
                for item in content:
                    if cache_control_count >= max_cache_control_blocks:
                        break
                    if isinstance(item, dict) and item.get("type") == "text" and "cache_control" not in item:
                        item["cache_control"] = {"type": "ephemeral", "ttl": "1h"}
                        cache_control_count += 1

    # Add reasoning_effort for Anthropic models if enabled
    use_thinking = enable_thinking if enable_thinking is not None else False
    is_anthropic = "anthropic" in effective_model_name.lower() or "claude" in effective_model_name.lower()

    if is_anthropic and use_thinking:
        effort_level = reasoning_effort if reasoning_effort else "low"
        params["reasoning_effort"] = effort_level
        params["temperature"] = 1.0  # Required by Anthropic when reasoning_effort is used
        logger.info(f"Anthropic thinking enabled with reasoning_effort='{effort_level}'")

    return params


def _build_router_params(params: dict[str, Any], router_model: str) -> dict[str, Any]:
    """Build params for Router.acompletion by copying prepared params and swapping model."""
    router_params = params.copy()
    router_params["model"] = router_model
    # Remove keys that the Router manages internally
    router_params.pop("api_key", None)
    router_params.pop("api_base", None)
    router_params.pop("model_id", None)
    router_params.pop("fallbacks", None)
    return router_params


def _map_litellm_exception(error: Exception) -> LLMError:
    """Map LiteLLM typed exceptions to user-friendly LLMError messages.

    Exception classes verified against litellm v1.80.7.
    NOTE: Subclasses must be checked before parent classes (e.g.,
    ContextWindowExceededError before BadRequestError).
    """
    # Check subclasses before parent classes
    if isinstance(error, litellm.ContextWindowExceededError):
        return LLMError("Context window exceeded. Your conversation is too long for this model.")
    if isinstance(error, litellm.ContentPolicyViolationError):
        return LLMError("Your input was flagged by content moderation.")
    if isinstance(error, litellm.BadRequestError):
        return LLMError("Bad request to API. Please check your request parameters.")
    if isinstance(error, litellm.AuthenticationError):
        return LLMError("Invalid API key or expired session. Please check your API key.")
    if isinstance(error, litellm.RateLimitError):
        return LLMError("Rate limit exceeded. Please wait a moment and try again.")
    if isinstance(error, litellm.Timeout):
        return LLMError("Request timed out. Please try again or use a different model.")
    if isinstance(error, litellm.ServiceUnavailableError):
        return LLMError("Model currently unavailable. Please try a different model.")
    if isinstance(error, litellm.InternalServerError):
        return LLMError("Model provider returned an error. Please try again.")

    # Status-code based fallback for unmapped exceptions
    status_code = getattr(error, "status_code", None)
    if status_code == 402:
        return LLMError("Insufficient credits. Please add more credits and try again.")
    if status_code == 403:
        return LLMError("Permission denied or content flagged by moderation.")

    error_msg = str(error)
    if "insufficient" in error_msg.lower() and "credit" in error_msg.lower():
        return LLMError("Insufficient credits. Please add more credits and try again.")
    return LLMError(f"API error: {error_msg}")


async def make_llm_api_call(
    messages: list[dict[str, Any]],
    model_name: str,
    response_format: Any | None = None,
    temperature: float = 0,
    max_tokens: int | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str = "auto",
    api_key: str | None = None,
    api_base: str | None = None,
    key_source: str = "system",
    user_id: str | None = None,
    stream: bool = False,
    top_p: float | None = None,
    model_id: str | None = None,
    enable_thinking: bool | None = False,
    reasoning_effort: str | None = "low",
) -> dict[str, Any] | AsyncGenerator:
    """Make an API call to a language model using LiteLLM or direct APIs.

    Args:
        messages: List of message dictionaries for the conversation
        model_name: Name of the model to use
        response_format: Desired format for the response
        temperature: Sampling temperature (0-1)
        max_tokens: Maximum tokens in the response
        tools: List of tool definitions for function calling
        tool_choice: How to select tools ("auto" or "none")
        api_key: Override default API key (for BYOK users)
        api_base: Override default API base URL
        key_source: "system" for platform key (Router path), "user_byok" for user's own key
        user_id: Account ID for OpenRouter abuse tracking (hashed before sending)
        stream: Whether to stream the response
        top_p: Top-p sampling parameter
        model_id: Optional ARN for Bedrock inference profiles
        enable_thinking: Whether to enable thinking
        reasoning_effort: Level of reasoning effort

    Returns:
        Union[Dict[str, Any], AsyncGenerator]: API response or stream

    Raises:
        LLMError: For API-related errors with user-friendly messages

    """
    logger.info(f"Making LLM API call to model: {model_name} (Thinking: {enable_thinking}, Effort: {reasoning_effort})")

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
        reasoning_effort=reasoning_effort,
    )

    # Pass hashed user_id for OpenRouter abuse tracking (never send raw internal IDs)
    if user_id and config.OPENROUTER_USER_HASH_SECRET:
        hash_secret = config.OPENROUTER_USER_HASH_SECRET.encode()
        hashed = hmac.new(hash_secret, user_id.encode(), hashlib.sha256).hexdigest()[:16]
        params["user"] = f"user-{hashed}"

    # =========================================================================
    # Path 1: Router (system key — Router has the key configured internally)
    # =========================================================================
    router = get_llm_router()
    router_model = get_router_model_name(model_name) if router else None

    if router and router_model and key_source == "system":
        logger.info(f"Using LiteLLM Router for model group: {router_model}")
        router_params = _build_router_params(params, router_model)
        try:
            return await asyncio.wait_for(router.acompletion(**router_params), timeout=LLM_CALL_TIMEOUT)
        except Exception as router_error:
            # Fallback: try direct litellm.acompletion with system key (same model)
            logger.warning(f"Router failed for {router_model}: {router_error}. Falling back to direct call.")
            try:
                return await asyncio.wait_for(
                    litellm.acompletion(**params, num_retries=MAX_RETRIES),
                    timeout=LLM_CALL_TIMEOUT,
                )
            except Exception as direct_error:
                raise _map_litellm_exception(direct_error) from direct_error

    # =========================================================================
    # Path 2: Direct call (BYOK or non-router models)
    # =========================================================================
    try:
        return await asyncio.wait_for(
            litellm.acompletion(**params, num_retries=MAX_RETRIES),
            timeout=LLM_CALL_TIMEOUT,
        )
    except Exception as e:
        raise _map_litellm_exception(e) from e


# ============================================================================
# Structured Output via Instructor
# ============================================================================


async def make_structured_llm_call(
    response_model,
    messages: list[dict[str, Any]],
    model_name: str,
    max_retries: int = 2,
    max_tokens: int = 1024,
    temperature: float = 0.0,
    api_key: str | None = None,
    api_base: str | None = None,
):
    """Make a structured LLM call that returns a validated Pydantic model.

    This is a convenience wrapper around services.structured_llm that
    integrates with the existing llm.py calling conventions (model_name, etc.).

    Args:
        response_model: Pydantic model class defining expected output shape
        messages: Chat messages for the LLM call
        model_name: Model name (will be passed directly to LiteLLM via Instructor)
        max_retries: Number of retries on validation failure
        max_tokens: Maximum tokens in response
        temperature: Sampling temperature
        api_key: Optional API key override
        api_base: Optional API base URL override

    Returns:
        Validated instance of response_model

    """
    from services.structured_llm import make_structured_llm_call as _structured_call

    return await _structured_call(
        response_model=response_model,
        messages=messages,
        model=model_name,
        max_retries=max_retries,
        max_tokens=max_tokens,
        temperature=temperature,
        api_key=api_key,
        api_base=api_base,
    )


# Initialize API keys on module import
setup_api_keys()
