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


def initialize():
    """Initialize Redis client."""
    global redis_client

    # Load environment variables if not already loaded
    load_dotenv()

    # Get Redis configuration
    redis_url = os.getenv("REDIS_URL")
    
    if not redis_url:
        raise ValueError("REDIS_URL environment variable is required")

    logger.info(f"Initializing Redis client...")
    logger.info(f"- Redis URL: {redis_url[:20]}...")

    # Create redis-py client for all operations
    redis_client = redis_py.from_url(redis_url)

    return redis_client


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
        logger.info(f"- Redis URL: {redis_url[:20]}...")

        # Create redis-py client for all operations
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


async def get_value(key: str) -> Optional[str]:
    """Get a value from Redis."""
    client = await get_client()
    result = await client.get(key)
    return result.decode('utf-8') if result else None


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


# For backward compatibility
get_redis_client = get_client