"""
Centralized database connection management for AgentPress using Supabase.
"""

from typing import Optional
from supabase import create_async_client, AsyncClient
from utils.logger import logger
from utils.config import config
import asyncio
import httpx
from contextlib import asynccontextmanager

class DBConnection:
    """Singleton database connection manager using Supabase."""
    
    _instance: Optional['DBConnection'] = None
    _initialized: bool = False
    _client: Optional[AsyncClient] = None
    _keepalive_task: Optional[asyncio.Task] = None
    _initialization_lock: Optional[asyncio.Lock] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            # Lock will be created lazily when needed (in async context)
        return cls._instance

    def __init__(self):
        """No initialization needed in __init__ as it's handled in __new__"""
        pass

    async def initialize(self):
        """Initialize the database connection."""
        # Create lock if it doesn't exist (lazy initialization)
        if self.__class__._initialization_lock is None:
            self.__class__._initialization_lock = asyncio.Lock()
        
        # Use lock to prevent concurrent initialization
        async with self.__class__._initialization_lock:
            if self.__class__._initialized:
                return
                    
            try:
                supabase_url = config.SUPABASE_URL
                # Use service role key preferentially for backend operations
                supabase_key = config.SUPABASE_SERVICE_ROLE_KEY or config.SUPABASE_ANON_KEY
                
                if not supabase_url or not supabase_key:
                    logger.error("Missing required environment variables for Supabase connection")
                    raise RuntimeError("SUPABASE_URL and a key (SERVICE_ROLE_KEY or ANON_KEY) environment variables must be set.")

                logger.debug("Initializing Supabase connection")
                self.__class__._client = await create_async_client(supabase_url, supabase_key)
                self.__class__._initialized = True
                key_type = "SERVICE_ROLE_KEY" if config.SUPABASE_SERVICE_ROLE_KEY else "ANON_KEY"
                logger.debug(f"Database connection initialized with Supabase using {key_type}")

                # Start a background keep-alive task to prevent idle disconnects
                if self.__class__._keepalive_task is None or self.__class__._keepalive_task.done():
                    self.__class__._keepalive_task = asyncio.create_task(self._keepalive_loop())
            except Exception as e:
                logger.error(f"Database initialization error: {e}")
                # Reset state on error
                self.__class__._initialized = False
                self.__class__._client = None
                raise RuntimeError(f"Failed to initialize database connection: {str(e)}")

    @classmethod
    async def disconnect(cls):
        """Disconnect from the database."""
        # Cancel keep-alive task first
        if cls._keepalive_task and not cls._keepalive_task.done():
            cls._keepalive_task.cancel()
            try:
                await cls._keepalive_task
            except asyncio.CancelledError:
                pass
            cls._keepalive_task = None
        
        if cls._client:
            logger.info("Disconnecting from Supabase database")
            await cls._client.close()
            cls._initialized = False
            cls._client = None
            logger.info("Database disconnected successfully")

    async def get_client(self) -> AsyncClient:
        """Get the Supabase client instance."""
        if not self.__class__._initialized:
            logger.debug("Supabase client not initialized, initializing now")
            await self.initialize()
        if not self.__class__._client:
            logger.error("Database client is None after initialization")
            raise RuntimeError("Database not initialized")
        return self.__class__._client

    @property
    def client(self):
        """Get the Supabase client property. Returns a coroutine that must be awaited."""
        return self.get_client()

    @asynccontextmanager
    async def get_async_client(self):
        """Get the async Supabase client as a context manager."""
        client = await self.get_client()
        try:
            yield client
        finally:
            # No cleanup needed for Supabase client - it's managed by the singleton
            pass

    async def _keepalive_loop(self, interval_seconds: int = 300):  # 5 minutes instead of 30 seconds
        """Periodically perform a lightweight query to keep the HTTP/2 channel warm.

        If the ping fails (e.g., because Supabase closed the idle connection), we
        close the client so the next real query re-opens a fresh socket.
        """
        logger.info(f"Starting Supabase keep-alive loop with {interval_seconds}s interval")
        try:
            while True:
                await asyncio.sleep(interval_seconds)
                if not self.__class__._initialized:
                    continue
                try:
                    # Use direct client access to avoid recursive initialization
                    if self.__class__._client is None:
                        continue
                    
                    # Lightweight query: just hit any known column (project_id) to keep socket alive
                    await self.__class__._client.table("projects").select("project_id").limit(1).execute()
                    logger.debug("Supabase keep-alive ping succeeded")
                except (httpx.RemoteProtocolError, httpx.ReadError) as e:
                    logger.warning(f"Supabase keep-alive failed, resetting client: {e}")
                    # Use the class lock to safely reset the client
                    if self.__class__._initialization_lock is not None:
                        async with self.__class__._initialization_lock:
                            if self.__class__._client:
                                await self.__class__._client.close()
                            self.__class__._client = None
                            self.__class__._initialized = False
                    else:
                        # No lock available, reset without protection (fallback)
                        if self.__class__._client:
                            await self.__class__._client.close()
                        self.__class__._client = None
                        self.__class__._initialized = False
                except Exception as e:
                    logger.warning(f"Supabase keep-alive error: {e}")
        except asyncio.CancelledError:
            logger.info("Supabase keep-alive loop cancelled")
            raise
        except Exception as e:
            logger.error(f"Supabase keep-alive loop terminated with error: {e}")
            raise
