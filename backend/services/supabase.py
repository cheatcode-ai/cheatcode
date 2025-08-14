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
    _initialized = False
    _client: Optional[AsyncClient] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        """No initialization needed in __init__ as it's handled in __new__"""
        pass

    async def initialize(self):
        """Initialize the database connection."""
        if self._initialized:
            return
                
        try:
            supabase_url = config.SUPABASE_URL
            # Use service role key preferentially for backend operations
            supabase_key = config.SUPABASE_SERVICE_ROLE_KEY or config.SUPABASE_ANON_KEY
            
            if not supabase_url or not supabase_key:
                logger.error("Missing required environment variables for Supabase connection")
                raise RuntimeError("SUPABASE_URL and a key (SERVICE_ROLE_KEY or ANON_KEY) environment variables must be set.")

            logger.debug("Initializing Supabase connection")
            self._client = await create_async_client(supabase_url, supabase_key)
            self._initialized = True
            key_type = "SERVICE_ROLE_KEY" if config.SUPABASE_SERVICE_ROLE_KEY else "ANON_KEY"
            logger.debug(f"Database connection initialized with Supabase using {key_type}")

            # Start a background keep-alive task to prevent idle disconnects
            if not hasattr(self, "_keepalive_task") or self._keepalive_task.done():
                self._keepalive_task = asyncio.create_task(self._keepalive_loop())
        except Exception as e:
            logger.error(f"Database initialization error: {e}")
            raise RuntimeError(f"Failed to initialize database connection: {str(e)}")

    @classmethod
    async def disconnect(cls):
        """Disconnect from the database."""
        if cls._client:
            logger.info("Disconnecting from Supabase database")
            await cls._client.close()
            cls._initialized = False
            logger.info("Database disconnected successfully")

    @property
    async def client(self) -> AsyncClient:
        """Get the Supabase client instance."""
        if not self._initialized:
            logger.debug("Supabase client not initialized, initializing now")
            await self.initialize()
        if not self._client:
            logger.error("Database client is None after initialization")
            raise RuntimeError("Database not initialized")
        return self._client

    @asynccontextmanager
    async def get_async_client(self):
        """Get the async Supabase client as a context manager."""
        client = await self.client
        try:
            yield client
        finally:
            # No cleanup needed for Supabase client - it's managed by the singleton
            pass

    async def _keepalive_loop(self, interval_seconds: int = 30):
        """Periodically perform a lightweight query to keep the HTTP/2 channel warm.

        If the ping fails (e.g., because Supabase closed the idle connection), we
        close the client so the next real query re-opens a fresh socket.
        """
        while True:
            await asyncio.sleep(interval_seconds)
            if not self._initialized:
                continue
            try:
                client = await self.client  # ensures initialized
                # Lightweight query: just hit any known column (project_id) to keep socket alive
                await client.table("projects").select("project_id").limit(1).execute()
                logger.debug("Supabase keep-alive ping succeeded")
            except (httpx.RemoteProtocolError, httpx.ReadError) as e:
                logger.warning(f"Supabase keep-alive failed, resetting client: {e}")
                await self._client.close()
                self._client = None
                self._initialized = False
            except Exception as e:
                logger.warning(f"Supabase keep-alive error: {e}")
