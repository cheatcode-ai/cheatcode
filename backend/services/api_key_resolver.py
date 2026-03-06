"""API Key Resolution Service.

Determines which API key to use for LLM calls based on user's plan and BYOK configuration.
Handles the logic for BYOK users vs regular users.
Enhanced with two-tier caching (local + Redis) for optimal performance.
"""

import time
from typing import Literal

from services import redis
from services.supabase import DBConnection
from services.user_openrouter_keys import OpenRouterKeyManager
from utils.config import config
from utils.logger import logger

# Cache configuration for user plans
USER_PLAN_CACHE_TTL = 300  # 5 minutes TTL for user plan data (Redis)

# Process-local LRU cache for user plan lookups.
_local_plan_cache: dict[str, tuple[str, float]] = {}
_LOCAL_PLAN_TTL = 120  # 2 minutes local TTL
_LOCAL_PLAN_MAX = 128  # max entries before eviction

KeySource = Literal["user_byok", "system", "none"]


class APIKeyResolver:
    """Resolves which OpenRouter API key to use for a given user."""

    @staticmethod
    async def get_openrouter_key_for_user(account_id: str) -> tuple[str | None, KeySource, str | None]:
        """Get the appropriate OpenRouter API key for a user.

        Args:
            account_id: User's account ID

        Returns:
            Tuple of (api_key, source, error_message)
            - api_key: The API key to use, or None if no key available
            - source: Where the key came from ("user_byok", "system", "none")
            - error_message: Error message if no key available, None otherwise

        """
        try:
            # First, check user's plan using centralized caching
            user_plan = await APIKeyResolver.get_user_plan_cached(account_id)

            if user_plan == "byok":
                # BYOK user - try to get their API key
                user_key = await OpenRouterKeyManager.get_api_key(account_id)
                if user_key:
                    logger.debug(f"Using BYOK OpenRouter key for user {account_id}")
                    return user_key, "user_byok", None
                # BYOK user but no key configured
                error_msg = "BYOK plan requires OpenRouter API key. Please configure your API key in settings."
                logger.warning(f"BYOK user {account_id} has no API key configured")
                return None, "none", error_msg
            # Regular user - use system key
            system_key = config.OPENROUTER_API_KEY
            if system_key:
                logger.debug(f"Using system OpenRouter key for user {account_id} (plan: {user_plan})")
                return system_key, "system", None
            # System key not configured
            error_msg = "System OpenRouter API key not configured"
            logger.error(f"System OpenRouter API key not available for user {account_id}")
            return None, "none", error_msg

        except Exception as e:
            error_msg = f"Error resolving API key for user {account_id}: {e!s}"
            logger.error(error_msg)
            return None, "none", error_msg

    @staticmethod
    async def get_user_plan_cached(account_id: str) -> str:
        """Get user's current billing plan with two-tier caching (local → Redis → DB).

        Args:
            account_id: User's account ID

        Returns:
            Plan ID (e.g., 'free', 'pro', 'premium', 'byok')

        """
        # Tier 1: process-local cache (0 Redis commands)
        entry = _local_plan_cache.get(account_id)
        if entry and entry[1] > time.monotonic():
            return entry[0]
        if entry:
            _local_plan_cache.pop(account_id, None)

        cache_key = f"user_plan:{account_id}"

        try:
            # Tier 2: Redis cache (1 command)
            cached_plan = await redis.get(cache_key)
            if cached_plan:
                logger.debug(f"Cache HIT: User {account_id} plan from Redis: {cached_plan}")
                # Populate local cache
                if len(_local_plan_cache) >= _LOCAL_PLAN_MAX:
                    oldest_key = next(iter(_local_plan_cache))
                    _local_plan_cache.pop(oldest_key, None)
                _local_plan_cache[account_id] = (cached_plan, time.monotonic() + _LOCAL_PLAN_TTL)
                return cached_plan

            # Cache miss - fetch from database
            plan_id = await APIKeyResolver._fetch_user_plan_from_db(account_id)

            # Populate both caches
            if len(_local_plan_cache) >= _LOCAL_PLAN_MAX:
                oldest_key = next(iter(_local_plan_cache))
                _local_plan_cache.pop(oldest_key, None)
            _local_plan_cache[account_id] = (plan_id, time.monotonic() + _LOCAL_PLAN_TTL)
            await redis.set(cache_key, plan_id, ex=USER_PLAN_CACHE_TTL)

            return plan_id

        except Exception as e:
            logger.error(f"Error getting cached user plan for {account_id}: {e!s}")
            return await APIKeyResolver._fetch_user_plan_from_db(account_id)

    @staticmethod
    async def _fetch_user_plan_from_db(account_id: str) -> str:
        """Fetch user's billing plan directly from database (no caching).

        Args:
            account_id: User's account ID

        Returns:
            Plan ID (e.g., 'free', 'pro', 'premium', 'byok')

        """
        try:
            db = DBConnection()
            async with db.get_async_client() as client:
                result = await client.table("users").select("plan_id").eq("id", account_id).execute()

                if result.data:
                    plan_id = result.data[0]["plan_id"]
                    logger.debug(f"Database fetch: User {account_id} has plan: {plan_id}")
                    return plan_id
                # Default to free if no billing record found
                logger.warning(f"No billing record found for user {account_id}, defaulting to free plan")
                return "free"

        except Exception as e:
            logger.error(f"Error fetching user plan from database for {account_id}: {e!s}")
            return "free"  # Default fallback

    @staticmethod
    async def clear_user_plan_cache(account_id: str) -> bool:
        """Clear cached plan data for a user (useful when plan changes).

        Args:
            account_id: User's account ID

        Returns:
            bool: True if cache was cleared, False otherwise

        """
        # Clear local cache first (always succeeds)
        _local_plan_cache.pop(account_id, None)

        try:
            cache_key = f"user_plan:{account_id}"
            result = await redis.delete(cache_key)
            logger.debug(f"Cleared plan cache for user {account_id}")
            return bool(result)
        except Exception as e:
            logger.error(f"Error clearing plan cache for user {account_id}: {e!s}")
            return False

    @staticmethod
    async def update_key_usage(account_id: str, key_source: KeySource) -> None:
        """Update usage tracking for the API key that was used.

        Args:
            account_id: User's account ID
            key_source: Source of the key that was used

        """
        try:
            if key_source == "user_byok":
                # Update last_used_at for user's BYOK key
                await OpenRouterKeyManager.update_last_used(account_id)
                logger.debug(f"Updated last_used_at for BYOK key for user {account_id}")
            # For system keys, we don't need to track individual usage

        except Exception as e:
            logger.error(f"Error updating key usage for user {account_id}: {e!s}")

    @staticmethod
    async def validate_user_can_use_byok(account_id: str) -> tuple[bool, str | None]:
        """Check if user can use BYOK functionality.

        Args:
            account_id: User's account ID

        Returns:
            Tuple of (can_use_byok, error_message)

        """
        try:
            user_plan = await APIKeyResolver.get_user_plan_cached(account_id)

            if user_plan != "byok":
                return False, f"BYOK functionality requires upgrade to BYOK plan. Current plan: {user_plan}"

            return True, None

        except Exception as e:
            error_msg = f"Error validating BYOK access for user {account_id}: {e!s}"
            logger.error(error_msg)
            return False, error_msg
