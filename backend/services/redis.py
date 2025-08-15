import os
from dotenv import load_dotenv
import asyncio
import redis.asyncio as redis_py
from utils.logger import logger
from typing import List, Any, Optional
from utils.retry import retry

# Simple Redis setup using redis-py for all operations
redis_client: redis_py.Redis | None = None
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

        # Load environment variables if not already loaded
        load_dotenv()

        # Get Redis configuration
        redis_url = os.getenv("REDIS_URL")
        
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
                socket_connect_timeout=120,  # 2 minutes for Upstash network latency
                socket_timeout=120,          # 2 minutes for pub/sub operations
                retry_on_timeout=True,       # Retry on timeout
                health_check_interval=60     # Health check every 60 seconds
            )
            

        else:
            # Create redis-py client for all operations (non-Upstash)
            redis_client = redis_py.from_url(redis_url)

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
    """Close Redis connections."""
    global redis_client, _initialized
    
    if redis_client:
        logger.info("Closing Redis connection")
        await redis_client.aclose()
        redis_client = None
    
    _initialized = False
    logger.info("Redis connection closed")


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


# For backward compatibility
get_redis_client = get_client