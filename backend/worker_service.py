#!/usr/bin/env python3
"""
Worker service that runs Dramatiq workers with a simple HTTP health endpoint.
This allows it to be deployed as a Cloud Run Service instead of a Job.
"""

import asyncio
import os
import subprocess
import threading
import time
from typing import Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import JSONResponse
import uvicorn
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variable to track worker process
worker_process: Optional[subprocess.Popen] = None
worker_thread: Optional[threading.Thread] = None

def run_dramatiq_worker():
    """Run the Dramatiq worker in a subprocess."""
    global worker_process
    
    logger.info("Starting Dramatiq worker...")
    
    try:
        # Start the Dramatiq worker
        worker_process = subprocess.Popen([
            "uv", "run", "python", "-m", "dramatiq", "run_agent_background"
        ], cwd="/app")
        
        logger.info(f"Dramatiq worker started with PID: {worker_process.pid}")
        
        # Wait for the process to complete
        worker_process.wait()
        
        logger.error(f"Dramatiq worker exited with code: {worker_process.returncode}")
        
    except Exception as e:
        logger.error(f"Error starting Dramatiq worker: {e}")

def start_worker_thread():
    """Start the Dramatiq worker in a background thread."""
    global worker_thread
    
    worker_thread = threading.Thread(target=run_dramatiq_worker, daemon=True)
    worker_thread.start()
    logger.info("Worker thread started")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage the lifespan of the FastAPI app."""
    # Startup
    logger.info("Starting up worker service...")
    start_worker_thread()
    yield
    # Shutdown
    global worker_process
    logger.info("Shutting down worker service...")
    
    if worker_process and worker_process.poll() is None:
        logger.info("Terminating Dramatiq worker...")
        worker_process.terminate()
        
        # Wait for graceful shutdown
        try:
            worker_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            logger.warning("Dramatiq worker didn't shut down gracefully, killing...")
            worker_process.kill()

# Create FastAPI app with lifespan
app = FastAPI(title="Dramatiq Worker Service", lifespan=lifespan)

@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run."""
    global worker_process
    
    # Check if worker process is running
    if worker_process is None:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "reason": "worker_not_started"}
        )
    
    # Check if process is still alive
    if worker_process.poll() is not None:
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "reason": "worker_died", "returncode": worker_process.poll()}
        )
    
    return JSONResponse(
        status_code=200,
        content={
            "status": "healthy",
            "worker_pid": worker_process.pid,
            "timestamp": time.time()
        }
    )

@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "Dramatiq Worker Service", "status": "running"}

if __name__ == "__main__":
    # Get port from environment (Cloud Run sets this)
    port = int(os.environ.get("PORT", 8080))
    
    logger.info(f"Starting worker service on port {port}")
    
    uvicorn.run(
        "worker_service:app",
        host="0.0.0.0",
        port=port,
        log_level="info"
    )
