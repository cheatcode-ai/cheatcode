from daytona_sdk import AsyncDaytona, DaytonaConfig, CreateSandboxFromSnapshotParams, AsyncSandbox, SessionExecuteRequest, Resources, SandboxState
import asyncio
from dotenv import load_dotenv
from utils.logger import logger
from utils.config import config
from utils.config import Configuration
import time

load_dotenv()

logger.debug("Initializing Daytona sandbox configuration")
daytona_config = DaytonaConfig(
    api_key=config.DAYTONA_API_KEY,
    api_url=config.DAYTONA_SERVER_URL,  # Use api_url instead of server_url (deprecated)
    target=config.DAYTONA_TARGET,
)

if daytona_config.api_key:
    logger.debug("Daytona API key configured successfully")
else:
    logger.warning("No Daytona API key found in environment variables")

if daytona_config.api_url:
    logger.debug(f"Daytona API URL set to: {daytona_config.api_url}")
else:
    logger.warning("No Daytona API URL found in environment variables")

if daytona_config.target:
    logger.debug(f"Daytona target set to: {daytona_config.target}")
else:
    logger.warning("No Daytona target found in environment variables")

daytona = AsyncDaytona(daytona_config)

async def get_or_start_sandbox(sandbox_id: str) -> AsyncSandbox:
    """Retrieve a sandbox by ID, check its state, and start it if needed with distributed locking."""
    
    # Import Redis here to avoid circular imports
    from services import redis
    
    logger.info(f"Getting or starting sandbox with ID: {sandbox_id}")
    
    # Use distributed lock to prevent concurrent start/stop operations on the same sandbox
    lock_key = f"sandbox_state_lock:{sandbox_id}"
    lock_value = f"start_operation:{asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'}:{int(time.time())}"
    
    # Try to acquire lock with reasonable timeout
    lock_acquired = await redis.set(lock_key, lock_value, nx=True, ex=60)  # 60 second timeout
    
    if not lock_acquired:
        # Check if lock is stale or wait briefly
        existing_lock = await redis.get(lock_key)
        if existing_lock:
            logger.info(f"Sandbox {sandbox_id} is being processed by another operation: {existing_lock}")
            # Wait a bit and try once more
            await asyncio.sleep(2.0)
            lock_acquired = await redis.set(lock_key, lock_value, nx=True, ex=60)
            
        if not lock_acquired:
            raise Exception(f"Cannot acquire lock for sandbox {sandbox_id} state operations")

    try:
        sandbox = await daytona.get(sandbox_id)
        
        # Check if sandbox needs to be started
        if sandbox.state == SandboxState.ARCHIVED or sandbox.state == SandboxState.STOPPED:
            logger.info(f"Sandbox is in {sandbox.state} state. Starting...")
            
            # Update lock to indicate start in progress
            start_lock_value = f"starting:{lock_value}"
            await redis.set(lock_key, start_lock_value, ex=120)  # Extend timeout for start operation
            
            try:
                await daytona.start(sandbox)

                # ----------------------------------------------------------
                # Wait until the sandbox actually transitions to RUNNING.
                # Daytona start() returns immediately but the VM may take a
                # few seconds to boot. We poll for up to 30s with backoff.
                # ----------------------------------------------------------
                max_wait_time = 30  # seconds
                poll_interval = 0.5
                max_polls = int(max_wait_time / poll_interval)
                
                for poll_count in range(max_polls):
                    sandbox = await daytona.get(sandbox_id)
                    if sandbox.state == SandboxState.RUNNING:
                        break
                    
                    # Progressive backoff: start with 0.5s, increase to 1s after 10 polls
                    if poll_count > 10:
                        poll_interval = 1.0
                    await asyncio.sleep(poll_interval)
                else:
                    logger.warning(
                        f"Sandbox {sandbox_id} still not RUNNING after {max_wait_time}s; current state is {sandbox.state}"
                    )
                    
                # For legacy image-based sandboxes, start supervisord
                # For new snapshot-based sandboxes, this is not needed
                try:
                    await start_supervisord_session(sandbox)
                except Exception as supervisord_error:
                    logger.debug(f"Supervisord not available (likely snapshot-based sandbox): {supervisord_error}")
                    # This is expected for snapshot-based sandboxes, continue normally
                    pass
                    
            except Exception as e:
                # If the Daytona Cloud returns a memory quota error, try to free up
                # memory by stopping the oldest running sandbox and retry once.
                error_msg = str(e)
                if "Total memory quota exceeded" in error_msg:
                    logger.warning("Daytona memory quota exceeded – attempting to stop the oldest running sandbox and retry")
                    try:
                        # Extend lock timeout for retry operation
                        await redis.set(lock_key, f"retrying_memory:{lock_value}", ex=180)
                        
                        # List all sandboxes and find running ones
                        sandboxes = await daytona.list()
                        # Filter RUNNING sandboxes that are not the one we're trying to start
                        running = [s for s in sandboxes if getattr(s, 'state', None) == SandboxState.RUNNING and s.id != sandbox_id]
                        if running:
                            # Sort by updated_at if available; fall back to created_at
                            running.sort(key=lambda s: getattr(s, 'updated_at', getattr(s, 'created_at', 0)))
                            oldest = running[0]
                            logger.info(f"Stopping oldest running sandbox {oldest.id} to free memory")
                            try:
                                # Use distributed lock for the sandbox we're stopping too
                                stop_lock_key = f"sandbox_state_lock:{oldest.id}"
                                stop_acquired = await redis.set(stop_lock_key, f"emergency_stop:{lock_value}", nx=True, ex=60)
                                if stop_acquired:
                                    try:
                                        await daytona.stop(oldest)
                                    finally:
                                        await redis.delete(stop_lock_key)
                                else:
                                    logger.warning(f"Could not acquire lock to stop sandbox {oldest.id}")
                            except Exception as stop_err:
                                logger.error(f"Failed to stop sandbox {oldest.id}: {stop_err}")
                        else:
                            logger.warning("No running sandboxes found to stop – cannot free memory")

                        # Retry starting the target sandbox once
                        await daytona.start(sandbox)
                    except Exception as retry_err:
                        logger.error(f"Retry after freeing memory failed: {retry_err}")
                        raise e  # Raise original error
                elif "RUNNING" in error_msg or "already running" in error_msg.lower():
                    # Sandbox is already running - this is fine, just continue
                    logger.debug(f"Sandbox {sandbox_id} is already running, continuing...")
                    pass
                else:
                    logger.error(f"Error starting sandbox: {e}")
                    raise e
        
        logger.info(f"Sandbox {sandbox_id} is ready")
        return sandbox
        
    except Exception as e:
        logger.error(f"Error retrieving or starting sandbox: {str(e)}")
        raise e
    finally:
        # Always release the distributed lock
        try:
            current_lock = await redis.get(lock_key)
            # Only delete if we still own the lock (check partial match since we may have updated the value)
            if current_lock and (lock_value in current_lock):
                await redis.delete(lock_key)
                logger.debug(f"Released sandbox state lock for {sandbox_id}")
            else:
                logger.debug(f"Sandbox state lock for {sandbox_id} was already released or owned by another process")
        except Exception as lock_cleanup_error:
            logger.warning(f"Failed to release sandbox state lock for {sandbox_id}: {lock_cleanup_error}")

async def start_supervisord_session(sandbox: AsyncSandbox):
    """Start supervisord in a session."""
    session_id = "supervisord-session"
    try:
        logger.info(f"Creating session {session_id} for supervisord")
        await sandbox.process.create_session(session_id)
        
        # Execute supervisord command
        await sandbox.process.execute_session_command(session_id, SessionExecuteRequest(
            command="exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf",
            var_async=True
        ))
        logger.info(f"Supervisord started in session {session_id}")
    except Exception as e:
        logger.error(f"Error starting supervisord session: {str(e)}")
        raise e



async def create_sandbox_from_snapshot(project_id: str = None, snapshot: str = config.SANDBOX_SNAPSHOT_NAME) -> AsyncSandbox:
    """Create a new sandbox from a snapshot optimized for development."""
    
    logger.debug(f"Creating new Daytona sandbox from snapshot: {snapshot}")
    
    # Infer app_type from snapshot name
    is_mobile = 'mobile' in snapshot.lower()
    workspace_dir = 'cheatcode-mobile' if is_mobile else 'cheatcode-app'
    
    logger.debug(f"Detected {'mobile' if is_mobile else 'web'} app type from snapshot: {snapshot}")
    
    labels = None
    if project_id:
        logger.debug(f"Using sandbox_id as label: {project_id}")
        labels = {'id': project_id}
        
    params = CreateSandboxFromSnapshotParams(
        snapshot=snapshot,
        public=True,
        labels=labels,
        env_vars={
            # Development environment variables
            "NODE_ENV": "development",
            "PNPM_HOME": "/usr/local/bin",
            "PATH": f"/workspace/{workspace_dir}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin"
        },
        auto_stop_interval=15,
        auto_archive_interval=24 * 60,
    )
    
    # Create the sandbox with extended timeout and retry for Daytona server timeouts
    max_retries = 2
    base_delay = 10  # seconds
    
    for attempt in range(max_retries + 1):
        try:
            if attempt > 0:
                delay = base_delay * (2 ** (attempt - 1))  # Exponential backoff: 10s, 20s
                logger.info(f"Retrying sandbox creation after {delay}s delay (attempt {attempt + 1}/{max_retries + 1})")
                await asyncio.sleep(delay)
            
            logger.info(f"Starting sandbox creation with 300s timeout for snapshot: {snapshot}")
            sandbox = await daytona.create(params, timeout=300)
            logger.info(f"Sandbox created successfully with ID: {sandbox.id}")
            return sandbox
            
        except asyncio.TimeoutError as e:
            logger.error(f"Sandbox creation timed out after 300 seconds for snapshot: {snapshot}")
            if attempt == max_retries:
                raise Exception(f"Sandbox creation timed out after {max_retries + 1} attempts. The snapshot '{snapshot}' may be too large or the Daytona server is overloaded.") from e
            continue
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Sandbox creation failed for snapshot {snapshot} (attempt {attempt + 1}): {error_msg}")
            
            # Check for Daytona server-side timeout (retryable)
            if "400" in error_msg and "Timeout after 60 seconds" in error_msg:
                logger.warning(f"Daytona server timeout during sandbox startup - this is often due to resource contention")
                if attempt < max_retries:
                    logger.info(f"Will retry sandbox creation (attempt {attempt + 2}/{max_retries + 1})")
                    continue
                else:
                    raise Exception(f"Sandbox creation failed after {max_retries + 1} attempts due to Daytona server timeouts. Try again later or contact support.") from e
            
            # Log details for other 400 errors (non-retryable)
            elif "400" in error_msg or "Bad Request" in error_msg:
                logger.error(f"400 Bad Request details - Check if snapshot '{snapshot}' exists and parameters are valid")
                logger.error(f"Request parameters: snapshot={snapshot}, public=True, labels={labels}")
                logger.warning(f"Snapshot '{snapshot}' may not exist or have invalid parameters.")
                raise Exception(f"Failed to create sandbox from snapshot '{snapshot}': {error_msg}") from e
            
            # For other errors, don't retry
            else:
                raise Exception(f"Failed to create sandbox from snapshot '{snapshot}': {error_msg}") from e
    
    logger.debug(f"Sandbox environment successfully initialized from snapshot")
    return sandbox

async def list_available_snapshots() -> list:
    """List all available snapshots in the Daytona instance."""
    try:
        # Note: This assumes the Daytona SDK has a method to list snapshots
        # You may need to check the actual SDK documentation for the correct method
        snapshots = await daytona.list_snapshots()
        logger.info(f"Available snapshots: {[s.name for s in snapshots]}")
        return snapshots
    except Exception as e:
        logger.error(f"Failed to list snapshots: {str(e)}")
        return []

async def delete_sandbox(sandbox_id: str) -> bool:
    """Delete a sandbox by its ID."""
    logger.info(f"Deleting sandbox with ID: {sandbox_id}")

    try:
        # Get the sandbox
        sandbox = await daytona.get(sandbox_id)
        
        # Delete the sandbox
        await daytona.delete(sandbox)
        
        logger.info(f"Successfully deleted sandbox {sandbox_id}")
        return True
    except Exception as e:
        logger.error(f"Error deleting sandbox {sandbox_id}: {str(e)}")
        raise e
