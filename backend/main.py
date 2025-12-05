from fastapi import FastAPI, Request, HTTPException, Response, Depends, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import sentry
from contextlib import asynccontextmanager
from agentpress.thread_manager import ThreadManager
from services.supabase import DBConnection
from datetime import datetime, timezone
from dotenv import load_dotenv
from utils.config import config, EnvMode
import asyncio
from utils.logger import logger, structlog
import time
from typing import Dict, Any
import os

from pydantic import BaseModel
import uuid
# Import the agent API module
from agent import api as agent_api

from sandbox import api as sandbox_api
from services import billing as billing_api
from api.webhooks import polar as polar_webhooks_api

from utils.config import config
import sys
from services import email_api
from composio_integration import api as composio_api
from composio_integration import secure_mcp_api as composio_secure_mcp_api


load_dotenv()

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

# Initialize managers
db = DBConnection()
instance_id = "single"

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting up FastAPI application with instance ID: {instance_id} in {config.ENV_MODE.value} mode")
    try:
        await db.initialize()
        
        agent_api.initialize(
            db,
            instance_id
        )
        

        
        sandbox_api.initialize(db)
        
        # Initialize Redis connection
        from services import redis
        try:
            await redis.initialize_async()
            logger.info("Redis connection initialized successfully")
            # Message broker (Redis) verified via initialization above
        except Exception as e:
            logger.error(f"Failed to initialize Redis connection: {e}")
            # Continue without Redis - the application will handle Redis failures gracefully
        
        # Start background tasks
        # asyncio.create_task(agent_api.restore_running_agent_runs())
        
        # Initialize Composio API
        composio_api.initialize(db)
        composio_secure_mcp_api.initialize(db)

        yield
        
        # Clean up agent resources
        logger.info("Cleaning up agent resources")
        await agent_api.cleanup()
        
        # Clean up Redis connection
        try:
            logger.info("Closing Redis connection")
            await redis.close()
            logger.info("Redis connection closed successfully")
        except Exception as e:
            logger.error(f"Error closing Redis connection: {e}")
        
        # Clean up database connection
        logger.info("Disconnecting from database")
        await db.disconnect()
    except Exception as e:
        logger.error(f"Error during application startup: {e}")
        raise

app = FastAPI(lifespan=lifespan)

def _sanitize_query_params(query_params) -> str:
    """Sanitize query parameters to mask sensitive values like tokens."""
    SENSITIVE_PARAMS = {'token', 'access_token', 'api_key', 'key', 'secret', 'password', 'auth'}

    sanitized = {}
    for key, value in query_params.items():
        if key.lower() in SENSITIVE_PARAMS or 'token' in key.lower() or 'key' in key.lower():
            # Mask the value, showing only first 4 and last 4 chars if long enough
            if len(value) > 12:
                sanitized[key] = f"{value[:4]}...{value[-4:]}"
            else:
                sanitized[key] = "***MASKED***"
        else:
            sanitized[key] = value

    return str(sanitized) if sanitized else ""


@app.middleware("http")
async def log_requests_middleware(request: Request, call_next):
    structlog.contextvars.clear_contextvars()

    request_id = str(uuid.uuid4())
    start_time = time.time()
    client_ip = request.client.host if request.client else "unknown"
    method = request.method
    path = request.url.path
    # Sanitize query params to avoid logging sensitive data like auth tokens
    query_params_sanitized = _sanitize_query_params(request.query_params)

    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        client_ip=client_ip,
        method=method,
        path=path,
        query_params=query_params_sanitized
    )

    # Log the incoming request
    logger.info(f"Request started: {method} {path} from {client_ip} | Query: {query_params_sanitized}")
    
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        logger.debug(f"Request completed: {method} {path} | Status: {response.status_code} | Time: {process_time:.2f}s")
        return response
    except Exception as e:
        process_time = time.time() - start_time
        logger.error(f"Request failed: {method} {path} | Error: {str(e)} | Time: {process_time:.2f}s")
        raise

# Define allowed origins based on environment
allowed_origins = ["https://www.trycheatcode.com", "https://trycheatcode.com"]
allow_origin_regex = None

# Add local-specific origins
if config.ENV_MODE == EnvMode.LOCAL:
    allowed_origins.append("http://localhost:3000")
    allowed_origins.append("http://localhost:3001")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Project-Id",
        "X-API-Key",
        "X-Refresh-Token",
        "X-MCP-URL",
        "X-MCP-Type"
    ],
)

# Create a main API router
api_router = APIRouter()

# Include all API routers without individual prefixes
api_router.include_router(agent_api.router)
api_router.include_router(sandbox_api.router)
api_router.include_router(billing_api.router)
api_router.include_router(polar_webhooks_api.router)


# Conditionally include feature flags API
if config.FEATURE_FLAGS_ENABLED:
    from flags import api as feature_flags_api
    api_router.include_router(feature_flags_api.router)

api_router.include_router(email_api.router)



# Composio integration API
api_router.include_router(composio_api.router)
api_router.include_router(composio_secure_mcp_api.router)

# User preferences API temporarily disabled due to import issues

# Add the new projects and threads API
import projects_threads_api
api_router.include_router(projects_threads_api.router)

# Add deployments API
from deployments import api as deployments_api
api_router.include_router(deployments_api.router)

@api_router.get("/health")
async def health_check():
    logger.info("Health check endpoint called")
    return {
        "status": "ok", 
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "instance_id": instance_id
    }

# Proxy endpoints removed - frontend now uses Daytona preview URLs directly

app.include_router(api_router, prefix="/api")


if __name__ == "__main__":
    import uvicorn
    
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
    workers = 4
    
    logger.info(f"Starting server on 0.0.0.0:8000 with {workers} workers")
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=8000,
        workers=workers,
        loop="asyncio"
    )