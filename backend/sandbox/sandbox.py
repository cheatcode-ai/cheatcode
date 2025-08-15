from daytona_sdk import AsyncDaytona, DaytonaConfig, CreateSandboxFromSnapshotParams, AsyncSandbox, SessionExecuteRequest, Resources, SandboxState
import asyncio
from dotenv import load_dotenv
from utils.logger import logger
from utils.config import config
from utils.config import Configuration

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
    """Retrieve a sandbox by ID, check its state, and start it if needed."""
    
    logger.info(f"Getting or starting sandbox with ID: {sandbox_id}")

    try:
        sandbox = await daytona.get(sandbox_id)
        
        # Check if sandbox needs to be started
        if sandbox.state == SandboxState.ARCHIVED or sandbox.state == SandboxState.STOPPED:
            logger.info(f"Sandbox is in {sandbox.state} state. Starting...")
            try:
                await daytona.start(sandbox)

                # ----------------------------------------------------------
                # Wait until the sandbox actually transitions to RUNNING.
                # Daytona start() returns immediately but the VM may take a
                # few seconds to boot. We poll for up to 15 s (30 × 0.5 s).
                # ----------------------------------------------------------
                for _ in range(30):
                    sandbox = await daytona.get(sandbox_id)
                    if sandbox.state == SandboxState.RUNNING:
                        break
                    await asyncio.sleep(0.5)
                else:
                    logger.warning(
                        f"Sandbox {sandbox_id} still not RUNNING after 15s; current state is {sandbox.state}"
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
                                await daytona.stop(oldest)
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
    
    # Create the sandbox
    sandbox = await daytona.create(params)
    logger.debug(f"Sandbox created with ID: {sandbox.id}")
    
    logger.debug(f"Sandbox environment successfully initialized from snapshot")
    return sandbox

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
