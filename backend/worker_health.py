import dotenv
dotenv.load_dotenv()

from utils.logger import logger
import run_agent_background
from services import redis
import asyncio
from utils.retry import retry
import uuid

async def main():
    """Health check for background workers."""
    try:
        await retry(lambda: redis.initialize_async())
        key = uuid.uuid4().hex
        
        # Send health check task
        run_agent_background.check_health.send(key)
        
        # Wait for response
        timeout = 20
        elapsed = 0
        while elapsed < timeout:
            result = await redis.get(key)
            if result == "healthy":
                break
            await asyncio.sleep(1)
            elapsed += 1

        if elapsed >= timeout:
            logger.critical("Health check timed out")
            exit(1)
        else:
            logger.critical("Health check passed")
            await redis.delete(key)
            await redis.close()
            exit(0)
    except Exception as e:
        logger.critical(f"Health check failed: {e}")
        exit(1)

if __name__ == "__main__":
    asyncio.run(main())