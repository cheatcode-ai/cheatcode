"""
Available AI models configuration - SINGLE SOURCE OF TRUTH.

All model-related data should be defined here and imported elsewhere.
This eliminates duplication across constants.py, llm.py, run.py, etc.
"""

from typing import List, Dict, Any, Optional

# Base CDN URL for provider logos from LobeHub icons
ICON_CDN_BASE = "https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-png/dark"

# =============================================================================
# SINGLE SOURCE OF TRUTH: All model configurations
# =============================================================================
# When adding/removing models, ONLY edit this list. Everything else is derived.
#
# Fields:
#   - id: Short identifier used in frontend/API
#   - openrouter_id: Full OpenRouter model ID for API calls
#   - name: Display name
#   - provider: Provider name (for UI grouping)
#   - description: Short description for UI
#   - max_tokens: Maximum OUTPUT tokens the model can generate
#   - context_window: Maximum INPUT context window size
#   - cost_input_per_1k: Cost per 1K input tokens (USD)
#   - cost_output_per_1k: Cost per 1K output tokens (USD)
#   - default: Whether this is the default model
#   - logo_url: URL to provider logo
# =============================================================================

AVAILABLE_MODELS: List[Dict[str, Any]] = [
    # xAI Grok models
    {
        "id": "grok-4.1-fast",
        "openrouter_id": "openrouter/x-ai/grok-4.1-fast",
        "name": "Grok 4.1 Fast",
        "provider": "xAI",
        "description": "Best agentic model",
        "max_tokens": 131072,
        "context_window": 131072,
        "cost_input_per_1k": 0.0002,
        "cost_output_per_1k": 0.0005,
        "default": False,
        "logo_url": f"{ICON_CDN_BASE}/grok.png",
    },
    {
        "id": "grok-code-fast",
        "openrouter_id": "openrouter/x-ai/grok-code-fast-1",
        "name": "Grok Code Fast",
        "provider": "xAI",
        "description": "Fast coding",
        "max_tokens": 131072,
        "context_window": 131072,
        "cost_input_per_1k": 0.0002,
        "cost_output_per_1k": 0.0015,
        "default": False,
        "logo_url": f"{ICON_CDN_BASE}/grok.png",
    },
    # Anthropic Claude models
    {
        "id": "claude-sonnet-4.5",
        "openrouter_id": "openrouter/anthropic/claude-sonnet-4.5",
        "name": "Claude Sonnet 4.5",
        "provider": "Anthropic",
        "description": "Best for coding",
        "max_tokens": 64000,
        "context_window": 200000,
        "cost_input_per_1k": 0.003,
        "cost_output_per_1k": 0.015,
        "default": True,
        "logo_url": f"{ICON_CDN_BASE}/anthropic.png",
    },
    {
        "id": "claude-opus-4.5",
        "openrouter_id": "openrouter/anthropic/claude-opus-4.5",
        "name": "Claude Opus 4.5",
        "provider": "Anthropic",
        "description": "Most capable",
        "max_tokens": 32000,
        "context_window": 200000,
        "cost_input_per_1k": 0.015,
        "cost_output_per_1k": 0.075,
        "default": False,
        "logo_url": f"{ICON_CDN_BASE}/anthropic.png",
    },
    # Google Gemini models
    {
        "id": "gemini-3-pro",
        "openrouter_id": "openrouter/google/gemini-3-pro-preview",
        "name": "Gemini 3 Pro",
        "provider": "Google",
        "description": "Flagship multimodal reasoning",
        "max_tokens": 65535,
        "context_window": 1000000,
        "cost_input_per_1k": 0.002,
        "cost_output_per_1k": 0.012,
        "default": False,
        "logo_url": f"{ICON_CDN_BASE}/gemini-color.png",
    },
    {
        "id": "gemini-pro-2.5",
        "openrouter_id": "openrouter/google/gemini-2.5-pro",
        "name": "Gemini Pro 2.5",
        "provider": "Google",
        "description": "Balanced",
        "max_tokens": 65535,
        "context_window": 1000000,
        "cost_input_per_1k": 0.0025,
        "cost_output_per_1k": 0.0075,
        "default": False,
        "logo_url": f"{ICON_CDN_BASE}/gemini-color.png",
    },
    # Zhipu GLM
    {
        "id": "glm-4.6",
        "openrouter_id": "openrouter/z-ai/glm-4.6",
        "name": "GLM 4.6",
        "provider": "Zhipu AI",
        "description": "Open-source frontier",
        "max_tokens": 128000,
        "context_window": 128000,
        "cost_input_per_1k": 0.0005,
        "cost_output_per_1k": 0.002,
        "default": False,
        "logo_url": f"{ICON_CDN_BASE}/zhipu.png",
    },
    # Moonshot Kimi
    {
        "id": "kimi-k2",
        "openrouter_id": "openrouter/moonshotai/kimi-k2",
        "name": "Kimi K2",
        "provider": "Moonshot",
        "description": "Strong reasoning",
        "max_tokens": 128000,
        "context_window": 128000,
        "cost_input_per_1k": 0.0006,
        "cost_output_per_1k": 0.0024,
        "default": False,
        "logo_url": f"{ICON_CDN_BASE}/moonshot.png",
    },
]


# =============================================================================
# Basic model lookup functions
# =============================================================================

def get_available_models() -> List[Dict[str, Any]]:
    """Return list of available models for frontend display."""
    return AVAILABLE_MODELS


def get_default_model() -> Dict[str, Any]:
    """Return the default model configuration."""
    for model in AVAILABLE_MODELS:
        if model.get("default"):
            return model
    return AVAILABLE_MODELS[0]


def get_model_by_id(model_id: str) -> Optional[Dict[str, Any]]:
    """Get model configuration by its short ID."""
    for model in AVAILABLE_MODELS:
        if model["id"] == model_id:
            return model
    return None


def get_model_by_openrouter_id(openrouter_id: str) -> Optional[Dict[str, Any]]:
    """Get model configuration by its OpenRouter ID."""
    for model in AVAILABLE_MODELS:
        if model["openrouter_id"] == openrouter_id:
            return model
    return None


def resolve_model_id(model_id: str) -> str:
    """
    Resolve a short model ID to the full OpenRouter model ID.
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
    """
    Get the max OUTPUT tokens for a model, with fallback default.

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
    """
    Get the context window (max INPUT tokens) for a model.

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
    """
    Get the cost per 1K tokens for a model.

    Args:
        model_id: Either short ID or full OpenRouter ID

    Returns:
        Tuple of (input_cost_per_1k, output_cost_per_1k) in USD
    """
    model = get_model_by_id(model_id) or get_model_by_openrouter_id(model_id)
    if model:
        return (
            model.get("cost_input_per_1k", 0.002),
            model.get("cost_output_per_1k", 0.006)
        )
    # Default fallback
    return (0.002, 0.006)


def calculate_token_cost(prompt_tokens: int, completion_tokens: int, model: str) -> float:
    """
    Calculate estimated cost in USD for token usage.

    Args:
        prompt_tokens: Number of input/prompt tokens
        completion_tokens: Number of output/completion tokens
        model: Model ID (short or OpenRouter format)

    Returns:
        Estimated cost in USD
    """
    input_cost, output_cost = get_model_costs(model)
    total_cost = (prompt_tokens / 1000 * input_cost) + (completion_tokens / 1000 * output_cost)
    return round(total_cost, 6)


# =============================================================================
# LiteLLM Router configuration (replaces hardcoded list in llm.py)
# =============================================================================

def get_router_model_list(openrouter_key: str) -> List[Dict[str, Any]]:
    """
    Generate LiteLLM Router model configuration from AVAILABLE_MODELS.

    Args:
        openrouter_key: OpenRouter API key

    Returns:
        List of model configurations for LiteLLM Router
    """
    if not openrouter_key:
        return []

    model_list = []
    for model in AVAILABLE_MODELS:
        model_list.append({
            "model_name": model["id"],
            "litellm_params": {
                "model": model["openrouter_id"],
                "api_key": openrouter_key,
            },
            "model_info": {"id": 1}
        })
    return model_list


def get_router_model_name(model_name: str) -> Optional[str]:
    """
    Map an OpenRouter model ID to the router group name (short ID).

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
    """
    Get the safe context compression limit for a model.
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
    if 'sonnet' in model_lower or 'claude' in model_lower:
        return 200000 - 64000 - 28000  # ~108K
    elif 'gpt' in model_lower:
        return 128000 - 28000  # 100K
    elif 'gemini' in model_lower:
        return 1000000 - 300000  # 700K
    else:
        return 41000 - 10000  # 31K default
