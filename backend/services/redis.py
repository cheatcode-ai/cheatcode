import asyncio
import redis.asyncio as redis_py
from utils.logger import logger
from typing import List, Any, Optional
from utils.retry import retry
from utils.config import config

# Simple Redis setup using redis-py for all operations with connection pooling
redis_client: redis_py.Redis | None = None
connection_pool: redis_py.ConnectionPool | None = None
_initialized = False
_init_lock = asyncio.Lock()




# Constants
REDIS_KEY_TTL = 3600 * 24  # 24 hour TTL as safety mechanism





async def initialize_async():
    """Initialize Redis connection asynchronously."""
    global redis_client, _initialized

    async with _init_lock:
        if _initialized:
            return

        # Get Redis configuration from centralized config
        redis_url = config.REDIS_URL
        
        if not redis_url:
            raise ValueError("REDIS_URL environment variable is required")

        logger.info(f"Initializing Redis client...")
        logger.info(f"- Redis URL: {redis_url[:25]}...")

        # Handle Upstash Redis URLs specially
        if "upstash.io" in redis_url:
            logger.info("Detected Upstash Redis - using direct redis-py connection")
            
            # Parse Redis URL to extract connection parameters
            # Format: rediss://default:password@host:port
            import urllib.parse
            parsed = urllib.parse.urlparse(redis_url)
            
            host = parsed.hostname
            port = parsed.port or 6379
            password = parsed.password
            use_ssl = parsed.scheme == "rediss"
            
            logger.info(f"- Host: {host}")
            logger.info(f"- Port: {port}")
            logger.info(f"- SSL: {use_ssl}")
            logger.info(f"- Using password-only authentication (no username)")
            
            # Create redis-py client with explicit parameters (no username for Upstash)
            # NOTE: Do NOT pass username parameter to Redis client for Upstash
            # Even though URL contains "default" username, Upstash only supports password auth
            redis_client = redis_py.Redis(
                host=host,
                port=port,
                password=password,  # Only password - no username parameter
                ssl=use_ssl,
                ssl_cert_reqs=None,  # Don't verify SSL certificates for Upstash
                decode_responses=True,  # Enable for easier string handling
                socket_connect_timeout=10,   # 10 seconds (optimized from 120)
                socket_timeout=15,           # 15 seconds (optimized from 120)
                retry_on_timeout=True,       # Retry on timeout
                health_check_interval=30,    # Health check every 30 seconds (optimized from 60)
                max_connections=128,         # Connection pool size (increased from 50)
                socket_keepalive=True,       # Enable TCP keepalive
                socket_keepalive_options={   # TCP keepalive options
                    'TCP_KEEPIDLE': 60,
                    'TCP_KEEPINTVL': 10,
                    'TCP_KEEPCNT': 3
                }
            )
            

        else:
            # Create explicit connection pool for better control (following Suna pattern)
            import urllib.parse
            parsed = urllib.parse.urlparse(redis_url)

            connection_pool = redis_py.ConnectionPool(
                host=parsed.hostname or 'redis',
                port=parsed.port or 6379,
                password=parsed.password,
                decode_responses=True,       # Decode bytes to strings automatically
                socket_timeout=15,           # 15 seconds socket timeout
                socket_connect_timeout=10,   # 10 seconds connection timeout
                socket_keepalive=True,       # Enable TCP keepalive
                retry_on_timeout=True,       # Retry on timeout
                health_check_interval=30,    # Health check every 30 seconds
                max_connections=128          # Connection pool size
            )

            # Create Redis client from connection pool
            redis_client = redis_py.Redis(connection_pool=connection_pool)

        try:
            # Test connection
            await redis_client.ping()
            logger.info("Redis connection verified")
            logger.info("Redis initialization completed successfully")
            _initialized = True
        except Exception as e:
            logger.error(f"Failed to initialize Redis: {e}")
            raise


async def close():
    """Close Redis connections and connection pool."""
    global redis_client, connection_pool, _initialized

    if redis_client:
        try:
            logger.info("Closing Redis connection")
            await asyncio.wait_for(redis_client.aclose(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("Redis client close timeout, forcing close")
        except Exception as e:
            logger.warning(f"Error closing Redis client: {e}")
        finally:
            redis_client = None

    if connection_pool:
        try:
            await asyncio.wait_for(connection_pool.aclose(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("Redis pool close timeout, forcing close")
        except Exception as e:
            logger.warning(f"Error closing Redis pool: {e}")
        finally:
            connection_pool = None

    _initialized = False
    logger.info("Redis connection and pool closed")


async def get_client():
    """Get the Redis client, initializing if necessary."""
    global redis_client, _initialized
    if not _initialized:
        await retry(lambda: initialize_async())
    return redis_client


async def ping():
    """Ping Redis to test connection."""
    client = await get_client()
    return await client.ping()


async def set_value(key: str, value: str, ttl: int = REDIS_KEY_TTL):
    """Set a value in Redis with optional TTL."""
    client = await get_client()
    return await client.set(key, value, ex=ttl)


async def set(key: str, value: str, ex: int = None, nx: bool = False):
    """Set a value in Redis with Redis-style parameters for compatibility."""
    client = await get_client()
    ttl = ex if ex is not None else REDIS_KEY_TTL
    return await client.set(key, value, ex=ttl, nx=nx)


async def get_value(key: str) -> Optional[str]:
    """Get a value from Redis."""
    client = await get_client()
    result = await client.get(key)
    return result  # Already decoded since decode_responses=True


async def delete_key(key: str) -> bool:
    """Delete a key from Redis."""
    client = await get_client()
    return bool(await client.delete(key))


async def exists(key: str) -> bool:
    """Check if a key exists in Redis."""
    client = await get_client()
    return bool(await client.exists(key))


async def increment(key: str, amount: int = 1) -> int:
    """Increment a key's value in Redis."""
    client = await get_client()
    return await client.incr(key, amount)


async def set_hash(key: str, mapping: dict, ttl: int = REDIS_KEY_TTL):
    """Set a hash in Redis."""
    client = await get_client()
    await client.hset(key, mapping=mapping)
    if ttl:
        await client.expire(key, ttl)


async def get_hash(key: str) -> dict:
    """Get a hash from Redis."""
    client = await get_client()
    return await client.hgetall(key)


async def add_to_list(key: str, value: str, ttl: int = REDIS_KEY_TTL):
    """Add a value to a Redis list."""
    client = await get_client()
    await client.lpush(key, value)
    if ttl:
        await client.expire(key, ttl)


async def get_list(key: str, start: int = 0, end: int = -1) -> List[str]:
    """Get values from a Redis list."""
    client = await get_client()
    return await client.lrange(key, start, end)


async def add_to_set(key: str, value: str, ttl: int = REDIS_KEY_TTL):
    """Add a value to a Redis set."""
    client = await get_client()
    await client.sadd(key, value)
    if ttl:
        await client.expire(key, ttl)


async def get_set_members(key: str) -> set:
    """Get members of a Redis set."""
    client = await get_client()
    return await client.smembers(key)


async def is_member_of_set(key: str, value: str) -> bool:
    """Check if a value is a member of a Redis set."""
    client = await get_client()
    return await client.sismember(key, value)


# Pub/Sub operations
async def publish(channel: str, message: str):
    """Publish a message to a Redis channel."""
    client = await get_client()
    return await client.publish(channel, message)


async def subscribe(channel: str):
    """Subscribe to a Redis channel."""
    client = await get_client()
    pubsub = client.pubsub()
    await pubsub.subscribe(channel)
    return pubsub


# Additional Redis operations used throughout the codebase
async def keys(pattern: str) -> List[str]:
    """Get keys matching a pattern. Use with caution in production."""
    client = await get_client()
    return await client.keys(pattern)


async def scan_keys(pattern: str, count: int = 1000) -> List[str]:
    """Efficiently scan for keys matching a pattern using SCAN instead of blocking KEYS."""
    client = await get_client()
    keys = []
    cursor = 0
    
    while True:
        cursor, partial_keys = await client.scan(cursor=cursor, match=pattern, count=count)
        keys.extend(partial_keys)
        if cursor == 0:
            break
    
    return keys


async def lrange(key: str, start: int, end: int) -> List[str]:
    """Get a range of elements from a list."""
    client = await get_client()
    return await client.lrange(key, start, end)


async def rpush(key: str, *values) -> int:
    """Push one or more values to the right of a list."""
    client = await get_client()
    return await client.rpush(key, *values)


async def expire(key: str, seconds: int) -> bool:
    """Set a timeout on a key."""
    client = await get_client()
    return await client.expire(key, seconds)


async def delete(key: str) -> int:
    """Delete a key. Returns number of keys deleted."""
    client = await get_client()
    return await client.delete(key)


async def get(key: str) -> Optional[str]:
    """Get a value from Redis (alias for get_value)."""
    return await get_value(key)


async def create_pubsub():
    """Create a pub/sub client."""
    client = await get_client()
    return client.pubsub()


# =============================================================================
# Account ID Caching - Performance Optimization
# =============================================================================

# Cache TTL for account_id lookups (1 hour)
ACCOUNT_ID_CACHE_TTL = 3600

async def get_account_id_cached(client, user_id: str) -> Optional[str]:
    """
    Get account_id for a Clerk user with Redis caching.

    This eliminates repeated RPC calls to get_account_id_for_clerk_user
    which was identified as a critical N+1 query performance issue.

    Args:
        client: Supabase client for RPC calls
        user_id: Clerk user ID

    Returns:
        Account ID string or None if not found
    """
    if not user_id:
        return None

    cache_key = f"account_id:{user_id}"

    try:
        # Try to get from cache first
        cached_account_id = await get_value(cache_key)
        if cached_account_id:
            logger.debug(f"Cache HIT for account_id: {user_id}")
            return cached_account_id
    except Exception as cache_error:
        logger.debug(f"Cache miss or error for account_id {user_id}: {str(cache_error)}")

    # Cache miss - fetch from database using centralized helper
    try:
        from utils.auth_utils import get_account_id_for_clerk_user
        account_id = await get_account_id_for_clerk_user(client, user_id)
        if not account_id:
            logger.debug(f"No account_id found for user {user_id}")
            return None

        # Cache the result
        try:
            await set_value(cache_key, account_id, ttl=ACCOUNT_ID_CACHE_TTL)
            logger.debug(f"Cached account_id for user {user_id}")
        except Exception as cache_set_error:
            logger.warning(f"Failed to cache account_id: {str(cache_set_error)}")

        return account_id

    except Exception as e:
        logger.error(f"Error fetching account_id for user {user_id}: {str(e)}")
        return None


async def invalidate_account_id_cache(user_id: str) -> bool:
    """
    Invalidate the account_id cache for a user.

    Call this when user-account mappings change.

    Args:
        user_id: Clerk user ID

    Returns:
        True if cache was invalidated, False otherwise
    """
    try:
        cache_key = f"account_id:{user_id}"
        await delete_key(cache_key)
        logger.debug(f"Invalidated account_id cache for user {user_id}")
        return True
    except Exception as e:
        logger.warning(f"Failed to invalidate account_id cache for {user_id}: {str(e)}")
        return False


# =============================================================================
# Response List Pruning - Memory Optimization
# =============================================================================

# Maximum responses to keep in a list (prevents memory bloat)
MAX_RESPONSE_LIST_SIZE = 5000


async def prune_response_list(response_list_key: str, max_size: int = MAX_RESPONSE_LIST_SIZE) -> int:
    """
    Prune a response list to keep only the most recent entries.

    This prevents memory bloat for long-running agent sessions that
    generate many responses.

    Args:
        response_list_key: The Redis list key to prune
        max_size: Maximum number of responses to keep

    Returns:
        Number of responses removed
    """
    try:
        client = await get_client()
        list_length = await client.llen(response_list_key)

        if list_length <= max_size:
            return 0

        # Calculate how many to trim (keep the most recent max_size entries)
        # LTRIM keeps elements from start to end (inclusive)
        # Since rpush adds to the end, we keep -max_size to -1 (most recent)
        trim_count = list_length - max_size
        await client.ltrim(response_list_key, trim_count, -1)

        logger.info(f"Pruned {trim_count} old responses from {response_list_key}")
        return trim_count

    except Exception as e:
        logger.warning(f"Failed to prune response list {response_list_key}: {str(e)}")
        return 0


async def get_response_list_stats(response_list_key: str) -> dict:
    """
    Get statistics about a response list.

    Args:
        response_list_key: The Redis list key

    Returns:
        Dict with list statistics
    """
    try:
        client = await get_client()
        list_length = await client.llen(response_list_key)
        ttl = await client.ttl(response_list_key)

        return {
            "key": response_list_key,
            "length": list_length,
            "ttl_seconds": ttl,
            "exceeds_max": list_length > MAX_RESPONSE_LIST_SIZE
        }
    except Exception as e:
        logger.warning(f"Failed to get stats for {response_list_key}: {str(e)}")
        return {"key": response_list_key, "error": str(e)}


async def cleanup_orphaned_agent_keys(max_age_hours: int = 48) -> dict:
    """
    Clean up orphaned agent run keys that may have been left behind.

    Scans for agent_run:* keys and removes those that:
    - Have no TTL set (orphaned)
    - Are older than max_age_hours

    Args:
        max_age_hours: Maximum age in hours before cleanup

    Returns:
        Dict with cleanup statistics
    """
    try:
        client = await get_client()
        cleaned_count = 0
        scanned_count = 0
        errors = []

        # Use scan to iterate through keys (non-blocking)
        agent_run_keys = await scan_keys("agent_run:*:responses")
        scanned_count = len(agent_run_keys)

        for key in agent_run_keys:
            try:
                ttl = await client.ttl(key)
                # ttl == -1 means no expiry set, ttl == -2 means key doesn't exist
                if ttl == -1:
                    # Key has no TTL - either set one or delete if empty
                    list_length = await client.llen(key)
                    if list_length == 0:
                        await client.delete(key)
                        cleaned_count += 1
                        logger.debug(f"Deleted empty orphaned key: {key}")
                    else:
                        # Set a TTL on orphaned keys with data
                        await client.expire(key, 3600 * 24)  # 24 hours
                        logger.debug(f"Set TTL on orphaned key: {key}")
            except Exception as key_error:
                errors.append(f"{key}: {str(key_error)}")

        result = {
            "scanned_keys": scanned_count,
            "cleaned_keys": cleaned_count,
            "errors": errors[:10] if errors else []  # Limit errors in response
        }

        if cleaned_count > 0:
            logger.info(f"Redis cleanup: removed {cleaned_count} orphaned keys")

        return result

    except Exception as e:
        logger.error(f"Error during orphaned key cleanup: {str(e)}")
        return {"error": str(e)}


async def get_redis_memory_stats() -> dict:
    """
    Get Redis memory statistics for monitoring.

    Returns:
        Dict with memory usage information
    """
    try:
        client = await get_client()
        info = await client.info("memory")

        return {
            "used_memory_human": info.get("used_memory_human", "unknown"),
            "used_memory_peak_human": info.get("used_memory_peak_human", "unknown"),
            "maxmemory_human": info.get("maxmemory_human", "unknown"),
            "mem_fragmentation_ratio": info.get("mem_fragmentation_ratio", 0),
        }
    except Exception as e:
        logger.warning(f"Failed to get Redis memory stats: {str(e)}")
        return {"error": str(e)}