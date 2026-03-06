import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))
from services import redis

logger = logging.getLogger(__name__)


class FeatureFlagManager:
    def __init__(self):
        """Initialize with existing Redis service."""
        self.flag_prefix = "feature_flag:"
        self.flag_list_key = "feature_flags:list"

    async def set_flag(self, key: str, enabled: bool, description: str = "") -> bool:
        """Set a feature flag to enabled or disabled."""
        try:
            flag_key = f"{self.flag_prefix}{key}"
            flag_data = {
                "enabled": str(enabled).lower(),
                "description": description,
                "updated_at": datetime.now(tz=UTC).isoformat(),
            }

            # Use the existing Redis service
            redis_client = await redis.get_client()
            await redis_client.hset(flag_key, mapping=flag_data)
            await redis_client.sadd(self.flag_list_key, key)

            logger.info(f"Set feature flag {key} to {enabled}")
            return True
        except Exception:
            logger.exception(f"Failed to set feature flag {key}")
            return False

    async def is_enabled(self, key: str) -> bool:
        """Check if a feature flag is enabled."""
        try:
            flag_key = f"{self.flag_prefix}{key}"
            redis_client = await redis.get_client()
            enabled = await redis_client.hget(flag_key, "enabled")
            return enabled == "true" if enabled else False
        except Exception:
            logger.exception(f"Failed to check feature flag {key}")
            # Return False by default if Redis is unavailable
            return False

    async def get_flag(self, key: str) -> dict[str, str] | None:
        """Get feature flag details."""
        try:
            flag_key = f"{self.flag_prefix}{key}"
            redis_client = await redis.get_client()
            flag_data = await redis_client.hgetall(flag_key)
            return flag_data if flag_data else None
        except Exception:
            logger.exception(f"Failed to get feature flag {key}")
            return None

    async def delete_flag(self, key: str) -> bool:
        """Delete a feature flag."""
        try:
            flag_key = f"{self.flag_prefix}{key}"
            redis_client = await redis.get_client()
            deleted = await redis_client.delete(flag_key)
            if deleted:
                await redis_client.srem(self.flag_list_key, key)
                logger.info(f"Deleted feature flag: {key}")
                return True
            return False
        except Exception:
            logger.exception(f"Failed to delete feature flag {key}")
            return False

    async def list_flags(self) -> dict[str, bool]:
        """List all feature flags with their status - optimized to reduce Redis calls."""
        try:
            redis_client = await redis.get_client()
            flag_keys = await redis_client.smembers(self.flag_list_key)
            flags = {}

            # Batch get all flag data in one pipeline operation instead of N+1 queries
            if flag_keys:
                pipe = redis_client.pipeline()
                for key in flag_keys:
                    flag_key = f"{self.flag_prefix}{key}"
                    pipe.hget(flag_key, "enabled")

                results = await pipe.execute()

                # Map results back to flag keys
                for i, key in enumerate(flag_keys):
                    enabled_value = results[i] if i < len(results) else None
                    flags[key] = enabled_value == "true" if enabled_value else False

            return flags
        except Exception:
            logger.exception("Failed to list feature flags")
            return {}

    async def get_all_flags_details(self) -> dict[str, dict[str, str]]:
        """Get all feature flags with detailed information - optimized with pipelining."""
        try:
            redis_client = await redis.get_client()
            flag_keys = await redis_client.smembers(self.flag_list_key)
            flags = {}

            # Batch get all flag details in one pipeline operation
            if flag_keys:
                pipe = redis_client.pipeline()
                for key in flag_keys:
                    flag_key = f"{self.flag_prefix}{key}"
                    pipe.hgetall(flag_key)

                results = await pipe.execute()

                # Map results back to flag keys
                for i, key in enumerate(flag_keys):
                    flag_data = results[i] if i < len(results) else None
                    if flag_data:
                        flags[key] = flag_data

            return flags
        except Exception:
            logger.exception("Failed to get all flags details")
            return {}


_flag_manager: FeatureFlagManager | None = None


def get_flag_manager() -> FeatureFlagManager:
    """Get the global feature flag manager instance."""
    global _flag_manager
    if _flag_manager is None:
        _flag_manager = FeatureFlagManager()
    return _flag_manager


# Async convenience functions
async def set_flag(key: str, enabled: bool, description: str = "") -> bool:
    return await get_flag_manager().set_flag(key, enabled, description)


async def is_enabled(key: str) -> bool:
    return await get_flag_manager().is_enabled(key)


async def enable_flag(key: str, description: str = "") -> bool:
    return await set_flag(key, True, description)


async def disable_flag(key: str, description: str = "") -> bool:
    return await set_flag(key, False, description)


async def delete_flag(key: str) -> bool:
    return await get_flag_manager().delete_flag(key)


async def list_flags() -> dict[str, bool]:
    return await get_flag_manager().list_flags()


async def get_flag_details(key: str) -> dict[str, str] | None:
    return await get_flag_manager().get_flag(key)
