import dotenv
dotenv.load_dotenv()

from utils.logger import logger
from services import redis
import asyncio
from utils.retry import retry
import os

async def main():
    """Health check for background workers - verify Redis connectivity."""
    try:
        # Check if Redis is accessible
        await retry(lambda: redis.initialize_async())

        # Verify we can write and read
        test_key = "health_check_test"
        await redis.set(test_key, "ok", ex=5)
        result = await redis.get(test_key)
        await redis.delete(test_key)

        # Redis returns bytes, decode it
        if result and (result == "ok" or result == b"ok" or (isinstance(result, bytes) and result.decode() == "ok")):
            logger.critical("Health check passed - Redis accessible")
            await redis.close()
            exit(0)
        else:
            logger.critical(f"Health check failed - Redis read/write test failed. Got: {result} (type: {type(result)})")
            exit(1)
    except Exception as e:
        logger.critical(f"Health check failed: {e}")
        exit(1)

if __name__ == "__main__":
    asyncio.run(main())