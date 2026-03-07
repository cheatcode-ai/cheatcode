"""Dynamic model discovery from OpenRouter API.

Fetches programming-focused models using OpenRouter's category filter,
then applies provider allowlist and caches in Redis + memory.
Automatically refreshes every hour to keep the model selector fresh.
"""

import asyncio
import json
import time
from typing import Any

import aiohttp

from services import redis
from utils.config import config
from utils.logger import logger

# Redis cache key and TTLs
CACHE_KEY = "openrouter:models:programming"
CACHE_TTL_SECONDS = 3600  # 1 hour Redis TTL
LOCAL_CACHE_TTL = 1800  # 30 min in-memory TTL

# Process-local cache
_local_cache: list[dict[str, Any]] | None = None
_local_cache_expiry: float = 0.0

# Logo CDN base
ICON_CDN_BASE = "https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-png/dark"

# Provider allowlist: only models from these providers are shown in the selector.
# To add a new provider, just add an entry here - models will appear automatically.
PROVIDER_CONFIG: dict[str, dict[str, str]] = {
    # Tier 1: Major frontier providers
    "anthropic": {"logo": "anthropic.png", "display": "Anthropic"},
    "google": {"logo": "gemini-color.png", "display": "Google"},
    "openai": {"logo": "openai.png", "display": "OpenAI"},
    "x-ai": {"logo": "grok.png", "display": "xAI"},
    # Tier 2: Strong coding / OSS providers
    "deepseek": {"logo": "deepseek-color.png", "display": "DeepSeek"},
    "qwen": {"logo": "qwen-color.png", "display": "Qwen"},
    "meta-llama": {"logo": "meta-color.png", "display": "Meta"},
    "mistralai": {"logo": "mistral-color.png", "display": "Mistral"},
    # Tier 3: Notable providers with popular models
    "moonshotai": {"logo": "moonshot.png", "display": "Moonshot"},
    "z-ai": {"logo": "zhipu.png", "display": "Zhipu AI"},
    "minimax": {"logo": "minimax.png", "display": "MiniMax"},
    "nvidia": {"logo": "nvidia.png", "display": "NVIDIA"},
    "amazon": {"logo": "aws.png", "display": "Amazon"},
    "cohere": {"logo": "cohere-color.png", "display": "Cohere"},
    "bytedance-seed": {"logo": "bytedance.png", "display": "ByteDance"},
    "stepfun": {"logo": "stepfun.png", "display": "StepFun"},
}

# Filtering rules
MIN_CONTEXT_LENGTH = 32000
MAX_PER_PROVIDER = 3
EXCLUDE_SUFFIXES = [":free", ":extended"]


async def _fetch_from_api() -> list[dict[str, Any]]:
    """Fetch programming models from OpenRouter API with tool support."""
    api_key = config.OPENROUTER_API_KEY
    if not api_key:
        logger.warning("OPENROUTER_API_KEY not set, cannot fetch dynamic models")
        return []

    url = "https://openrouter.ai/api/v1/models"
    headers = {"Authorization": f"Bearer {api_key}"}
    params = {"category": "programming"}

    async with aiohttp.ClientSession() as session:
        async with session.get(
            url, headers=headers, params=params, timeout=aiohttp.ClientTimeout(total=15)
        ) as resp:
            if resp.status != 200:
                logger.error(f"OpenRouter models API returned {resp.status}")
                return []
            data = await resp.json()
            models = data.get("data", [])
            logger.info(f"Fetched {len(models)} programming models from OpenRouter")
            return models


def _map_model(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Map an OpenRouter model to our internal format. Returns None to skip."""
    model_id = raw.get("id", "")  # e.g. "anthropic/claude-sonnet-4.6"
    if "/" not in model_id:
        return None

    provider_slug, model_slug = model_id.split("/", 1)

    # Provider allowlist check
    if provider_slug not in PROVIDER_CONFIG:
        return None

    # Exclude free/extended variants
    if any(model_id.endswith(suffix) for suffix in EXCLUDE_SUFFIXES):
        return None

    # Context length check
    context_length = raw.get("context_length") or 0
    if context_length < MIN_CONTEXT_LENGTH:
        return None

    provider = PROVIDER_CONFIG[provider_slug]
    pricing = raw.get("pricing", {})
    top_provider = raw.get("top_provider", {})

    # Convert pricing: OpenRouter gives per-token string, we store per-1K tokens float
    cost_input_per_1k = float(pricing.get("prompt", "0")) * 1000
    cost_output_per_1k = float(pricing.get("completion", "0")) * 1000

    max_completion = top_provider.get("max_completion_tokens")
    if not max_completion:
        max_completion = 8192

    # Truncate description to first sentence or 100 chars
    description = raw.get("description", "") or ""
    first_sentence_end = description.find(". ")
    if first_sentence_end > 0 and first_sentence_end < 100:
        description = description[: first_sentence_end + 1]
    elif len(description) > 100:
        description = description[:97] + "..."

    return {
        "id": model_slug,
        "openrouter_id": f"openrouter/{model_id}",
        "name": raw.get("name", model_slug),
        "provider": provider["display"],
        "description": description,
        "max_tokens": int(max_completion),
        "context_window": int(context_length),
        "cost_input_per_1k": round(cost_input_per_1k, 6),
        "cost_output_per_1k": round(cost_output_per_1k, 6),
        "default": False,
        "logo_url": f"{ICON_CDN_BASE}/{provider['logo']}",
        "_provider_slug": provider_slug,
        "_created": raw.get("created", 0),
    }


def _filter_and_curate(mapped: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort by newest first, limit per provider, set default."""
    # Sort newest first within each provider
    mapped.sort(key=lambda m: m.get("_created", 0), reverse=True)

    # Limit per provider
    provider_counts: dict[str, int] = {}
    result: list[dict[str, Any]] = []
    for model in mapped:
        slug = model["_provider_slug"]
        count = provider_counts.get(slug, 0)
        if count < MAX_PER_PROVIDER:
            result.append(model)
            provider_counts[slug] = count + 1

    # Set default model
    found_default = False

    # If MODEL_TO_USE is explicitly set (via env), use that as override
    if config.MODEL_TO_USE:
        for m in result:
            if m["id"] == config.MODEL_TO_USE:
                m["default"] = True
                found_default = True
                break

    # Auto-detect: latest Anthropic Sonnet model (models already sorted newest-first)
    if not found_default:
        for m in result:
            if m["_provider_slug"] == "anthropic" and "sonnet" in m["id"].lower():
                m["default"] = True
                found_default = True
                break

    if not found_default:
        # Fallback: first Anthropic model, or first overall
        for m in result:
            if m["_provider_slug"] == "anthropic":
                m["default"] = True
                found_default = True
                break
        if not found_default and result:
            result[0]["default"] = True

    # Remove internal fields
    for m in result:
        m.pop("_provider_slug", None)
        m.pop("_created", None)

    return result


async def refresh_models() -> list[dict[str, Any]]:
    """Fetch from OpenRouter API, filter, curate, cache, and update model store."""
    global _local_cache, _local_cache_expiry

    try:
        raw_models = await _fetch_from_api()
        if not raw_models:
            logger.warning("No models from OpenRouter API, keeping current cache")
            return _get_current_models()

        mapped = [m for raw in raw_models if (m := _map_model(raw)) is not None]
        if not mapped:
            logger.warning("All models filtered out, keeping current cache")
            return _get_current_models()

        result = _filter_and_curate(mapped)
        logger.info(f"Curated {len(result)} models from {len(raw_models)} raw models")

        # Update local cache
        _local_cache = result
        _local_cache_expiry = time.monotonic() + LOCAL_CACHE_TTL

        # Update Redis cache
        try:
            await redis.set(CACHE_KEY, json.dumps(result), ex=CACHE_TTL_SECONDS)
        except Exception as e:
            logger.warning(f"Failed to cache models in Redis: {e}")

        # Update the in-memory model store used by sync lookup functions
        from utils.models import update_model_store

        update_model_store(result)

        # Refresh the LiteLLM Router with new model configurations
        from services.llm import refresh_router

        refresh_router()

        return result

    except Exception as e:
        logger.error(f"Failed to refresh models from OpenRouter: {e}")
        return _get_current_models()


def _get_current_models() -> list[dict[str, Any]]:
    """Return current in-memory models (cached or fallback)."""
    if _local_cache:
        return _local_cache
    from utils.models import get_available_models

    return get_available_models()


async def get_available_models_cached() -> list[dict[str, Any]]:
    """Get models from cache (local -> Redis -> API fetch)."""
    global _local_cache, _local_cache_expiry

    # Tier 1: local in-memory cache
    if _local_cache and time.monotonic() < _local_cache_expiry:
        return _local_cache

    # Tier 2: Redis cache
    try:
        cached = await redis.get(CACHE_KEY)
        if cached:
            models = json.loads(cached)
            _local_cache = models
            _local_cache_expiry = time.monotonic() + LOCAL_CACHE_TTL

            # Also update model store for sync lookups
            from utils.models import update_model_store

            update_model_store(models)
            return models
    except Exception as e:
        logger.warning(f"Redis cache read failed: {e}")

    # Tier 3: Fetch fresh from API
    return await refresh_models()


async def start_periodic_refresh(interval: int = CACHE_TTL_SECONDS):
    """Background task that refreshes models every `interval` seconds.

    Sleeps first since refresh_models() is called explicitly on startup.
    """
    await asyncio.sleep(interval)
    while True:
        try:
            await refresh_models()
            logger.info(f"Model refresh complete, next in {interval}s")
        except Exception as e:
            logger.error(f"Periodic model refresh failed: {e}")
        await asyncio.sleep(interval)
