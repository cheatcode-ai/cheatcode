from daytona import (
    AsyncDaytona,
    DaytonaConfig,
    CreateSandboxFromSnapshotParams,
    AsyncSandbox,
    SessionExecuteRequest,
    Resources,
    SandboxState,
)
import asyncio
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv
from utils.logger import logger
from utils.config import config
from utils.config import Configuration
import time

load_dotenv()

# Resource tier configurations for different workload types
RESOURCE_TIERS = {
    "light": Resources(cpu=1, memory=2, disk=10),      # Light workloads, basic testing
    "standard": Resources(cpu=2, memory=4, disk=20),   # Standard development
    "heavy": Resources(cpu=4, memory=8, disk=40),      # Heavy builds, large projects
}

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

async def get_sandbox(sandbox_id: str) -> AsyncSandbox:
    """Retrieve a sandbox by ID without locking.

    Use this for read-only operations like status checks, preview URL retrieval, etc.
    This function does NOT start the sandbox if it's stopped - it just returns the current state.

    Args:
        sandbox_id: The sandbox ID to retrieve

    Returns:
        AsyncSandbox instance

    Raises:
        Exception if sandbox cannot be retrieved
    """
    logger.debug(f"Getting sandbox (no lock): {sandbox_id}")
    try:
        sandbox = await daytona.get(sandbox_id)
        return sandbox
    except Exception as e:
        logger.error(f"Error retrieving sandbox {sandbox_id}: {e}")
        raise e


async def get_or_start_sandbox(sandbox_id: str) -> AsyncSandbox:
    """Retrieve a sandbox by ID, check its state, and start it if needed with distributed locking."""

    # Import Redis here to avoid circular imports
    from services import redis

    logger.info(f"Getting or starting sandbox with ID: {sandbox_id}")
    
    # Use distributed lock to prevent concurrent start/stop operations on the same sandbox
    lock_key = f"sandbox_state_lock:{sandbox_id}"
    lock_value = f"start_operation:{asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'}:{int(time.time())}"

    # Try to acquire lock with exponential backoff for better performance
    lock_acquired = False
    for attempt in range(4):  # 4 attempts with backoff
        lock_acquired = await redis.set(lock_key, lock_value, nx=True, ex=10)  # 10 second timeout (reduced from 60)
        if lock_acquired:
            break

        if attempt < 3:  # Don't wait on last attempt
            # Exponential backoff: 0.1s, 0.2s, 0.4s
            delay = 0.1 * (2 ** attempt)
            existing_lock = await redis.get(lock_key)
            if existing_lock:
                # Decode bytes to string if needed
                if isinstance(existing_lock, bytes):
                    existing_lock = existing_lock.decode('utf-8')
                logger.debug(f"Sandbox {sandbox_id} locked by: {existing_lock}, waiting {delay}s (attempt {attempt + 1}/4)")
            await asyncio.sleep(delay)

    if not lock_acquired:
        raise Exception(f"Cannot acquire lock for sandbox {sandbox_id} state operations after 4 attempts")

    try:
        sandbox = await daytona.get(sandbox_id)
        
        # Check if sandbox needs to be started
        if sandbox.state == SandboxState.ARCHIVED or sandbox.state == SandboxState.STOPPED:
            logger.info(f"Sandbox is in {sandbox.state} state. Starting...")
            
            # Update lock to indicate start in progress
            start_lock_value = f"starting:{lock_value}"
            await redis.set(lock_key, start_lock_value, ex=30)  # 30s timeout for start operation (reduced from 120)
            
            try:
                await daytona.start(sandbox)

                # ----------------------------------------------------------
                # Use built-in SDK wait method for sandbox to reach RUNNING state.
                # This is more reliable than manual polling.
                # ----------------------------------------------------------
                try:
                    await sandbox.wait_for_sandbox_start(timeout=60)
                    logger.info(f"Sandbox {sandbox_id} is now in RUNNING state")
                except Exception as wait_error:
                    # Fallback: refresh and check state manually
                    logger.warning(f"Built-in wait failed, checking state manually: {wait_error}")
                    await sandbox.refresh_data()
                    if sandbox.state != SandboxState.RUNNING:
                        logger.warning(f"Sandbox {sandbox_id} not RUNNING after wait; current state is {sandbox.state}")

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
                                        # Use built-in wait for stop completion
                                        try:
                                            await oldest.wait_for_sandbox_stop(timeout=30)
                                            logger.info(f"Sandbox {oldest.id} stopped successfully")
                                        except Exception as stop_wait_err:
                                            logger.warning(f"Stop wait failed for {oldest.id}: {stop_wait_err}")
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
            # Decode bytes to string if needed
            if isinstance(current_lock, bytes):
                current_lock = current_lock.decode('utf-8')
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



async def create_sandbox_from_snapshot(
    project_id: str = None,
    snapshot: str = config.SANDBOX_SNAPSHOT_NAME,
    account_id: str = None,
    resource_tier: str = "standard",
    custom_labels: Optional[Dict[str, str]] = None,
    auto_stop_interval: int = 15,
    auto_archive_interval: int = 24 * 60,
) -> AsyncSandbox:
    """Create a new sandbox from a snapshot optimized for development.

    Args:
        project_id: Project identifier for tracking
        snapshot: Snapshot name to create sandbox from
        account_id: User account ID for resource tracking
        resource_tier: Resource tier ('light', 'standard', 'heavy')
        custom_labels: Additional labels to apply to sandbox
        auto_stop_interval: Minutes of inactivity before auto-stop (0 to disable)
        auto_archive_interval: Minutes after stop before auto-archive

    Returns:
        AsyncSandbox instance
    """

    logger.debug(f"Creating new Daytona sandbox from snapshot: {snapshot}")

    # Infer app_type from snapshot name
    is_mobile = 'mobile' in snapshot.lower()
    workspace_dir = 'cheatcode-mobile' if is_mobile else 'cheatcode-app'
    app_type = 'mobile' if is_mobile else 'web'

    logger.debug(f"Detected {app_type} app type from snapshot: {snapshot}")

    # Build comprehensive labels for better sandbox organization and discovery
    labels = {
        'created_by': 'cheatcode',
        'app_type': app_type,
        'environment': 'development',
    }

    if project_id:
        labels['project_id'] = project_id
        labels['id'] = project_id  # Keep for backward compatibility

    if account_id:
        labels['account_id'] = account_id

    # Merge custom labels if provided
    if custom_labels:
        labels.update(custom_labels)

    logger.debug(f"Sandbox labels: {labels}")

    # Get resource configuration based on tier
    resources = RESOURCE_TIERS.get(resource_tier, RESOURCE_TIERS["standard"])
    logger.debug(f"Using resource tier '{resource_tier}': cpu={resources.cpu}, memory={resources.memory}GB, disk={resources.disk}GB")

    params = CreateSandboxFromSnapshotParams(
        snapshot=snapshot,
        public=True,
        labels=labels,
        resources=resources,
        env_vars={
            # Development environment variables
            "NODE_ENV": "development",
            "PNPM_HOME": "/usr/local/bin",
            "PATH": f"/workspace/{workspace_dir}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin"
        },
        auto_stop_interval=auto_stop_interval,
        auto_archive_interval=auto_archive_interval,
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
        snapshots = await daytona.snapshot.list()
        logger.info(f"Available snapshots: {[s.name for s in snapshots]}")
        return snapshots
    except Exception as e:
        logger.error(f"Failed to list snapshots: {str(e)}")
        return []


async def delete_sandbox(sandbox_id: str, timeout: int = 60) -> bool:
    """Delete a sandbox by its ID.

    Args:
        sandbox_id: ID of sandbox to delete
        timeout: Timeout in seconds for deletion operation

    Returns:
        True if deleted successfully
    """
    logger.info(f"Deleting sandbox with ID: {sandbox_id}")

    try:
        # Get the sandbox
        sandbox = await daytona.get(sandbox_id)

        # Delete the sandbox with timeout
        await daytona.delete(sandbox, timeout=timeout)

        logger.info(f"Successfully deleted sandbox {sandbox_id}")
        return True
    except Exception as e:
        logger.error(f"Error deleting sandbox {sandbox_id}: {str(e)}")
        raise e


# ============================================================================
# Label-based Sandbox Discovery Functions
# ============================================================================

async def find_sandbox_by_project(project_id: str) -> Optional[AsyncSandbox]:
    """Find a sandbox by its project ID using labels.

    Args:
        project_id: The project ID to search for

    Returns:
        AsyncSandbox if found, None otherwise
    """
    try:
        sandboxes = await daytona.list(labels={'project_id': project_id})
        if sandboxes:
            logger.debug(f"Found sandbox for project {project_id}: {sandboxes[0].id}")
            return sandboxes[0]
        return None
    except Exception as e:
        logger.error(f"Failed to find sandbox for project {project_id}: {e}")
        return None


async def find_sandboxes_by_account(account_id: str) -> List[AsyncSandbox]:
    """Find all sandboxes belonging to a user account.

    Args:
        account_id: The user account ID

    Returns:
        List of AsyncSandbox instances
    """
    try:
        sandboxes = await daytona.list(labels={'account_id': account_id})
        logger.debug(f"Found {len(sandboxes)} sandboxes for account {account_id}")
        return sandboxes
    except Exception as e:
        logger.error(f"Failed to list sandboxes for account {account_id}: {e}")
        return []


async def find_sandboxes_by_labels(labels: Dict[str, str]) -> List[AsyncSandbox]:
    """Find sandboxes matching the specified labels.

    Args:
        labels: Dictionary of labels to match

    Returns:
        List of matching AsyncSandbox instances
    """
    try:
        sandboxes = await daytona.list(labels=labels)
        logger.debug(f"Found {len(sandboxes)} sandboxes matching labels {labels}")
        return sandboxes
    except Exception as e:
        logger.error(f"Failed to find sandboxes with labels {labels}: {e}")
        return []


async def stop_sandbox(sandbox_id: str, timeout: int = 60) -> bool:
    """Stop a sandbox and wait for it to reach stopped state.

    Args:
        sandbox_id: ID of sandbox to stop
        timeout: Timeout in seconds for stop operation

    Returns:
        True if stopped successfully
    """
    logger.info(f"Stopping sandbox {sandbox_id}")

    try:
        sandbox = await daytona.get(sandbox_id)

        if sandbox.state == SandboxState.STOPPED:
            logger.info(f"Sandbox {sandbox_id} is already stopped")
            return True

        await daytona.stop(sandbox)

        # Use built-in wait method
        try:
            await sandbox.wait_for_sandbox_stop(timeout=timeout)
            logger.info(f"Sandbox {sandbox_id} stopped successfully")
        except Exception as wait_error:
            logger.warning(f"Wait for stop failed: {wait_error}")
            # Refresh and verify
            await sandbox.refresh_data()
            if sandbox.state != SandboxState.STOPPED:
                logger.warning(f"Sandbox {sandbox_id} may not have stopped; state is {sandbox.state}")

        return True
    except Exception as e:
        logger.error(f"Error stopping sandbox {sandbox_id}: {str(e)}")
        raise e


async def get_sandbox_info(sandbox_id: str) -> Optional[Dict[str, Any]]:
    """Get detailed information about a sandbox.

    Args:
        sandbox_id: ID of sandbox

    Returns:
        Dictionary with sandbox information
    """
    try:
        sandbox = await daytona.get(sandbox_id)
        await sandbox.refresh_data()

        return {
            'id': sandbox.id,
            'state': str(sandbox.state),
            'cpu': getattr(sandbox, 'cpu', None),
            'memory': getattr(sandbox, 'memory', None),
            'labels': getattr(sandbox, 'labels', {}),
            'created_at': getattr(sandbox, 'created_at', None),
            'updated_at': getattr(sandbox, 'updated_at', None),
        }
    except Exception as e:
        logger.error(f"Failed to get sandbox info for {sandbox_id}: {e}")
        return None


async def set_sandbox_auto_intervals(
    sandbox_id: str,
    auto_stop_interval: Optional[int] = None,
    auto_archive_interval: Optional[int] = None
) -> bool:
    """Update auto-stop and auto-archive intervals for a sandbox.

    Args:
        sandbox_id: ID of sandbox
        auto_stop_interval: Minutes of inactivity before auto-stop (0 to disable)
        auto_archive_interval: Minutes after stop before auto-archive (0 for max)

    Returns:
        True if updated successfully
    """
    try:
        sandbox = await daytona.get(sandbox_id)

        if auto_stop_interval is not None:
            await sandbox.set_autostop_interval(auto_stop_interval)
            logger.info(f"Set auto-stop interval to {auto_stop_interval} minutes for {sandbox_id}")

        if auto_archive_interval is not None:
            await sandbox.set_auto_archive_interval(auto_archive_interval)
            logger.info(f"Set auto-archive interval to {auto_archive_interval} minutes for {sandbox_id}")

        return True
    except Exception as e:
        logger.error(f"Failed to update auto intervals for {sandbox_id}: {e}")
        return False
