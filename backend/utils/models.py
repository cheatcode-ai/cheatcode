"""Available AI models configuration.

Models are dynamically fetched from OpenRouter API (programming category)
and cached. All lookup functions read from an in-memory store that is
updated by services.openrouter_models on startup and periodically.
"""

from typing import Any

# =============================================================================
# Dynamic model store: updated by services.openrouter_models
# Starts empty, populated from OpenRouter on startup.
# =============================================================================

_model_store: list[dict[str, Any]] = []


def update_model_store(models: list[dict[str, Any]]) -> None:
    """Replace the in-memory model store with fresh models.

    Called by services.openrouter_models after fetching from OpenRouter API.
    """
    global _model_store
    _model_store = models


# =============================================================================
# Basic model lookup functions (read from _model_store)
# =============================================================================


def get_available_models() -> list[dict[str, Any]]:
    """Return list of available models for frontend display."""
    return _model_store


def get_default_model() -> dict[str, Any] | None:
    """Return the default model configuration, or None if store is empty."""
    for model in _model_store:
        if model.get("default"):
            return model
    return _model_store[0] if _model_store else None


def get_default_model_id() -> str | None:
    """Return the ID of the default model, or None if store is empty."""
    model = get_default_model()
    return model["id"] if model else None


def get_model_by_id(model_id: str) -> dict[str, Any] | None:
    """Get model configuration by its short ID."""
    for model in _model_store:
        if model["id"] == model_id:
            return model
    return None


def get_model_by_openrouter_id(openrouter_id: str) -> dict[str, Any] | None:
    """Get model configuration by its OpenRouter ID."""
    for model in _model_store:
        if model["openrouter_id"] == openrouter_id:
            return model
    return None


def resolve_model_id(model_id: str) -> str:
    """Resolve a short model ID to the full OpenRouter model ID.

    Returns the original ID if not found (for backwards compatibility).
    """
    model = get_model_by_id(model_id)
    if model:
        return model["openrouter_id"]
    # If not found, return as-is (might be a full OpenRouter ID already)
    return model_id


# =============================================================================
# Max tokens functions (replaces hardcoded if/elif in run.py)
# =============================================================================


def get_max_tokens_for_model(model_id: str) -> int:
    """Get the max OUTPUT tokens for a model, with fallback default.

    Args:
        model_id: Either short ID (e.g., "claude-sonnet-4.5") or
                  full OpenRouter ID (e.g., "openrouter/anthropic/claude-sonnet-4.5")

    Returns:
        Maximum output tokens the model can generate

    """
    # Try short ID first
    model = get_model_by_id(model_id)
    if model:
        return model.get("max_tokens", 8192)

    # Try full OpenRouter ID
    model = get_model_by_openrouter_id(model_id)
    if model:
        return model.get("max_tokens", 8192)

    # Default fallback
    return 8192


def get_context_window_for_model(model_id: str) -> int:
    """Get the context window (max INPUT tokens) for a model.

    Args:
        model_id: Either short ID or full OpenRouter ID

    Returns:
        Maximum input context window size

    """
    model = get_model_by_id(model_id) or get_model_by_openrouter_id(model_id)
    if model:
        return model.get("context_window", 128000)
    return 128000  # Default fallback


# =============================================================================
# Cost calculation functions (replaces hardcoded dict in constants.py)
# =============================================================================


def get_model_costs(model_id: str) -> tuple:
    """Get the cost per 1K tokens for a model.

    Args:
        model_id: Either short ID or full OpenRouter ID

    Returns:
        Tuple of (input_cost_per_1k, output_cost_per_1k) in USD

    """
    model = get_model_by_id(model_id) or get_model_by_openrouter_id(model_id)
    if model:
        return (model.get("cost_input_per_1k", 0.002), model.get("cost_output_per_1k", 0.006))
    # Default fallback
    return (0.002, 0.006)


def calculate_token_cost(prompt_tokens: int, completion_tokens: int, model: str) -> float:
    """Calculate estimated cost in USD using LiteLLM's pricing database.

    Falls back to model store pricing if the model is not in LiteLLM's DB.

    Args:
        prompt_tokens: Number of input/prompt tokens
        completion_tokens: Number of output/completion tokens
        model: Model ID (short or OpenRouter format)

    Returns:
        Estimated cost in USD

    """
    import litellm as _litellm

    from utils.logger import logger as _logger

    try:
        prompt_cost, completion_cost = _litellm.cost_per_token(
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
        return round(prompt_cost + completion_cost, 6)
    except Exception:
        _logger.warning(f"Model {model} not found in LiteLLM pricing DB, using hardcoded fallback")
        # Fallback to hardcoded pricing for models not in LiteLLM DB
        input_cost, output_cost = get_model_costs(model)
        return round((prompt_tokens / 1000 * input_cost) + (completion_tokens / 1000 * output_cost), 6)


# =============================================================================
# LiteLLM Router configuration (replaces hardcoded list in llm.py)
# =============================================================================


def get_router_model_list(openrouter_key: str) -> list[dict[str, Any]]:
    """Generate LiteLLM Router model configuration from the model store.

    Args:
        openrouter_key: OpenRouter API key

    Returns:
        List of model configurations for LiteLLM Router

    """
    if not openrouter_key:
        return []

    return [
        {
            "model_name": model["id"],
            "litellm_params": {
                "model": model["openrouter_id"],
                "api_key": openrouter_key,
            },
            "model_info": {"id": 1},
        }
        for model in _model_store
    ]


def get_router_model_name(model_name: str) -> str | None:
    """Map an OpenRouter model ID to the router group name (short ID).

    Args:
        model_name: Full OpenRouter model ID

    Returns:
        Short model ID if found, None otherwise

    """
    model = get_model_by_openrouter_id(model_name)
    if model:
        return model["id"]
    return None


# =============================================================================
# Context compression helper (for context_manager.py)
# =============================================================================


def get_context_compression_limit(model_id: str) -> int:
    """Get the safe context compression limit for a model.

    This accounts for output token reservation and safety margin.

    Args:
        model_id: Model ID (short or OpenRouter format)

    Returns:
        Maximum tokens to use for compressed context

    """
    model = get_model_by_id(model_id) or get_model_by_openrouter_id(model_id)

    if model:
        context_window = model.get("context_window", 128000)
        max_output = model.get("max_tokens", 8192)
        # Reserve space for output + 28K safety margin
        safety_margin = 28000
        return context_window - max_output - safety_margin

    # Fallback based on provider pattern matching (for unknown models)
    model_lower = model_id.lower()
    if "sonnet" in model_lower or "claude" in model_lower:
        return 200000 - 64000 - 28000  # ~108K
    if "gpt" in model_lower:
        return 128000 - 28000  # 100K
    if "gemini" in model_lower:
        return 1000000 - 300000  # 700K
    return 41000 - 10000  # 31K default
