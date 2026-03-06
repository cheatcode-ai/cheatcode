"""Structured LLM service using Instructor for validated, typed outputs.

Wraps LiteLLM calls with Pydantic model validation via the Instructor library.
Provides automatic retries where validation errors are fed back to the LLM,
and optional cost tracking via create_with_completion().

Usage:
    from services.structured_llm import make_structured_llm_call
    from agent.schemas import ProjectName

    result = await make_structured_llm_call(
        response_model=ProjectName,
        messages=[{"role": "user", "content": "Generate a project name for a todo app"}],
        model="openrouter/anthropic/claude-sonnet-4.5",
    )
    print(result.name)  # Typed, validated output
"""

from typing import Any, TypeVar

import instructor
import litellm
from pydantic import BaseModel

from utils.logger import logger

T = TypeVar("T", bound=BaseModel)

# Module-level async instructor client (lazy-initialized)
_async_client: instructor.AsyncInstructor | None = None


def _register_hooks(client: instructor.AsyncInstructor) -> None:
    """Register Instructor lifecycle hooks for observability.

    Hooks fire automatically on every call including retries,
    catching events that manual logging at the call site would miss.
    """

    def on_completion_kwargs(kwargs: dict[str, Any]) -> None:
        logger.info(
            "Structured LLM request",
            model=kwargs.get("model", "unknown"),
        )

    def on_completion_response(response: Any) -> None:
        usage = getattr(response, "usage", None)
        model = getattr(response, "model", "unknown")
        usage_info = {}
        if usage:
            usage_info = {
                "prompt_tokens": getattr(usage, "prompt_tokens", 0),
                "completion_tokens": getattr(usage, "completion_tokens", 0),
            }
        logger.info(
            "Structured LLM response",
            model=model,
            usage=usage_info,
        )

    def on_completion_error(error: Exception) -> None:
        logger.error(
            "Structured LLM error",
            error_type=type(error).__name__,
            error=str(error),
        )

    def on_parse_error(error: Exception) -> None:
        logger.warning(
            "Structured LLM parse error (will retry)",
            error_type=type(error).__name__,
            error=str(error),
        )

    client.on("completion:kwargs", on_completion_kwargs)
    client.on("completion:response", on_completion_response)
    client.on("completion:error", on_completion_error)
    client.on("parse:error", on_parse_error)


def _get_async_client() -> instructor.AsyncInstructor:
    """Get or create the async Instructor client wrapping LiteLLM.

    Uses instructor.from_litellm() which patches litellm.acompletion
    to add structured output validation and retry logic.
    """
    global _async_client
    if _async_client is None:
        _async_client = instructor.from_litellm(
            litellm.acompletion,
            mode=instructor.Mode.TOOLS,
        )
        _register_hooks(_async_client)
        logger.info("Instructor async client initialized (mode=TOOLS, wrapping litellm.acompletion)")
    return _async_client


async def make_structured_llm_call(
    response_model: type[T],
    messages: list[dict[str, Any]],
    model: str,
    max_retries: int = 2,
    max_tokens: int = 1024,
    temperature: float = 0.0,
    api_key: str | None = None,
    api_base: str | None = None,
) -> T:
    """Make a structured LLM call that returns a validated Pydantic model.

    Instructor handles:
    - Injecting the response_model schema into the LLM call
    - Parsing the LLM response into the Pydantic model
    - Retrying with validation error feedback if parsing fails

    Args:
        response_model: Pydantic model class defining expected output shape
        messages: Chat messages for the LLM call
        model: Model identifier (e.g., "openrouter/anthropic/claude-sonnet-4.5")
        max_retries: Number of retries on validation failure (default 2)
        max_tokens: Maximum tokens in response
        temperature: Sampling temperature
        api_key: Optional API key override
        api_base: Optional API base URL override

    Returns:
        Validated instance of response_model

    Raises:
        instructor.exceptions.InstructorRetryException: After exhausting retries
        Exception: For non-validation LLM errors (timeouts, auth, etc.)

    """
    client = _get_async_client()

    kwargs: dict[str, Any] = {
        "response_model": response_model,
        "messages": messages,
        "model": model,
        "max_retries": max_retries,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    if api_key:
        kwargs["api_key"] = api_key
    if api_base:
        kwargs["api_base"] = api_base

    logger.info(
        "Structured LLM call",
        model=model,
        response_model=response_model.__name__,
        max_retries=max_retries,
    )

    result = await client.create(**kwargs)

    logger.info(
        "Structured LLM call succeeded",
        model=model,
        response_model=response_model.__name__,
    )

    return result


async def make_structured_llm_call_with_usage(
    response_model: type[T],
    messages: list[dict[str, Any]],
    model: str,
    max_retries: int = 2,
    max_tokens: int = 1024,
    temperature: float = 0.0,
    api_key: str | None = None,
    api_base: str | None = None,
) -> tuple[T, dict[str, Any]]:
    """Make a structured LLM call and also return token usage info.

    Uses create_with_completion() to get both the validated model and the
    raw completion object for cost tracking / billing.

    Returns:
        Tuple of (validated_model, usage_dict) where usage_dict contains:
        - prompt_tokens: int
        - completion_tokens: int
        - total_tokens: int
        - model: str (actual model used)

    """
    client = _get_async_client()

    kwargs: dict[str, Any] = {
        "response_model": response_model,
        "messages": messages,
        "model": model,
        "max_retries": max_retries,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    if api_key:
        kwargs["api_key"] = api_key
    if api_base:
        kwargs["api_base"] = api_base

    logger.info(
        "Structured LLM call (with usage)",
        model=model,
        response_model=response_model.__name__,
        max_retries=max_retries,
    )

    result, completion = await client.create_with_completion(**kwargs)

    # Extract usage info from the raw completion
    usage_info: dict[str, Any] = {}
    if hasattr(completion, "usage") and completion.usage:
        usage_info = {
            "prompt_tokens": getattr(completion.usage, "prompt_tokens", 0),
            "completion_tokens": getattr(completion.usage, "completion_tokens", 0),
            "total_tokens": getattr(completion.usage, "total_tokens", 0),
            "model": getattr(completion, "model", model),
        }

    logger.info(
        "Structured LLM call succeeded (with usage)",
        model=model,
        response_model=response_model.__name__,
        usage=usage_info,
    )

    return result, usage_info
