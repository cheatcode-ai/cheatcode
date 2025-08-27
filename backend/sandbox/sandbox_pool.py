import asyncio
import time
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, field
from datetime import datetime
import asyncio, timedelta
from collections import defaultdict
import uuid

from daytona_sdk import AsyncSandbox, SandboxState
from utils.logger import logger
from utils.config import config

@dataclass
class SandboxMetrics:
    """Metrics for sandbox usage and performance."""
    created_at: datetime
    last_used: datetime
    total_requests: int = 0
    dev_server_info: Optional[dict] = None  # Track dev server session info
    avg_response_time: float = 0.0
    memory_usage: float = 0.0
    cpu_usage: float = 0.0
    active_sessions: int = 0

@dataclass
class PoolConfig:
    """Configuration for sandbox pool management."""
    min_warm_sandboxes: int = 2
    max_total_sandboxes: int = 50
    max_idle_time: timedelta = timedelta(minutes=30)
    max_session_time: timedelta = timedelta(hours=2)
    cleanup_interval: timedelta = timedelta(minutes=5)
    scale_threshold: float = 0.8  # Scale up when 80% of sandboxes are in use

class SandboxPool:
    """
    Manages a pool of sandboxes for optimal resource utilization and scaling.
    Handles warm-up, cleanup, and auto-scaling based on demand.
    """
    
    def __init__(self, config: PoolConfig = None):
        self.config = config or PoolConfig()
        self.active_sandboxes: Dict[str, AsyncSandbox] = {}
        # Separate warm pools for different app types
        self.warm_sandboxes: Dict[str, List[AsyncSandbox]] = {
            'web': [],
            'mobile': []
        }
        self.sandbox_metrics: Dict[str, SandboxMetrics] = {}
        self.user_sandboxes: Dict[str, str] = {}  # user_id -> sandbox_id
        self.sandbox_users: Dict[str, str] = {}   # sandbox_id -> user_id
        self.sandbox_app_types: Dict[str, str] = {}  # sandbox_id -> app_type
        self.cleanup_task: Optional[asyncio.Task] = None
        self.scaling_lock = asyncio.Lock()
        
    async def start(self):
        """Initialize the pool with warm sandboxes."""
        logger.info("Starting sandbox pool...")
        
        # Start cleanup task
        self.cleanup_task = asyncio.create_task(self._cleanup_loop())
        
        # Pre-warm initial sandboxes
        await self._ensure_warm_sandboxes()
        
        total_warm = len(self.warm_sandboxes['web']) + len(self.warm_sandboxes['mobile'])
        logger.info(f"Sandbox pool started with {total_warm} warm sandboxes ({len(self.warm_sandboxes['web'])} web, {len(self.warm_sandboxes['mobile'])} mobile)")
    
    async def stop(self):
        """Shutdown the pool and cleanup resources."""
        logger.info("Stopping sandbox pool...")
        
        if self.cleanup_task:
            self.cleanup_task.cancel()
            try:
                await self.cleanup_task
            except asyncio.CancelledError:
                pass
        
        # Cleanup all sandboxes
        await self._cleanup_all_sandboxes()
        
        logger.info("Sandbox pool stopped")
    
    async def get_sandbox_for_user(self, user_id: str, project_id: str, app_type: str = 'web') -> AsyncSandbox:
        """
        Get or create a sandbox for a specific user and project.
        Reuses existing sandbox if available, otherwise allocates from warm pool.
        Thread-safe implementation with proper locking.
        """
        # Use distributed Redis lock for cross-instance safety with monitoring
        from services import redis
        from utils.concurrency_monitor import get_monitor, monitored_lock
        
        lock_key = f"sandbox_allocation_lock:{user_id}"
        lock_value = f"{id(self)}:{asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'}"
        
        # Try to acquire distributed lock with monitoring
        client = await redis.get_client()
        lock_acquired = await monitored_lock(
            lock_key, 
            "sandbox_allocation", 
            client, 
            lock_value, 
            timeout=30,
            metadata={"user_id": user_id, "app_type": app_type, "project_id": project_id}
        )
        
        if not lock_acquired:
            # Wait briefly and retry once
            await asyncio.sleep(0.1)
            lock_acquired = await monitored_lock(
                lock_key, 
                "sandbox_allocation_retry", 
                client, 
                lock_value, 
                timeout=30,
                metadata={"user_id": user_id, "app_type": app_type, "retry": True}
            )
            if not lock_acquired:
                raise Exception(f"Failed to acquire sandbox allocation lock for user {user_id}")
        
        try:
            # Double-check pattern: verify user doesn't have sandbox after acquiring lock
            if user_id in self.user_sandboxes:
                sandbox_id = self.user_sandboxes[user_id]
                if sandbox_id in self.active_sandboxes:
                    sandbox = self.active_sandboxes[sandbox_id]
                    # Verify sandbox is still valid
                    try:
                        if sandbox.state and hasattr(sandbox, 'state'):
                            await self._update_metrics(sandbox_id, "reuse")
                            return sandbox
                    except Exception as e:
                        logger.warning(f"Sandbox {sandbox_id} appears invalid, will allocate new one: {e}")
                        # Clean up invalid sandbox reference
                        if sandbox_id in self.active_sandboxes:
                            del self.active_sandboxes[sandbox_id]
                        if user_id in self.user_sandboxes:
                            del self.user_sandboxes[user_id]
                        if sandbox_id in self.sandbox_users:
                            del self.sandbox_users[sandbox_id]
            
            # Get sandbox from warm pool or create new one
            sandbox = await self._allocate_sandbox(user_id, project_id, app_type)
            
            # Atomic assignment - only assign if not already assigned
            if user_id not in self.user_sandboxes:
                self.user_sandboxes[user_id] = sandbox.id
                self.sandbox_users[sandbox.id] = user_id
            else:
                # Another thread assigned during allocation, clean up this sandbox
                logger.warning(f"User {user_id} was assigned sandbox during allocation, cleaning up duplicate")
                await self._terminate_sandbox(sandbox)
                # Return the already assigned sandbox
                existing_sandbox_id = self.user_sandboxes[user_id]
                if existing_sandbox_id in self.active_sandboxes:
                    return self.active_sandboxes[existing_sandbox_id]
            
            # Update metrics
            await self._update_metrics(sandbox.id, "allocate")
            
            # Check if we need to scale up (in background to avoid blocking)
            asyncio.create_task(self._check_scaling())
            
            return sandbox
            
        finally:
            # Always release the distributed lock with monitoring
            try:
                from utils.concurrency_monitor import monitored_lock_release
                await monitored_lock_release(
                    lock_key,
                    "sandbox_allocation",
                    client,
                    lock_value,
                    metadata={"user_id": user_id, "app_type": app_type}
                )
            except Exception as e:
                logger.warning(f"Failed to release sandbox allocation lock for {user_id}: {e}")
    
    async def release_sandbox(self, user_id: str, keep_warm: bool = True):
        """
        Release a sandbox from a user. Can either return to warm pool or terminate.
        """
        if user_id not in self.user_sandboxes:
            return
        
        sandbox_id = self.user_sandboxes[user_id]
        
        # Remove user assignment
        del self.user_sandboxes[user_id]
        if sandbox_id in self.sandbox_users:
            del self.sandbox_users[sandbox_id]
        
        if sandbox_id in self.active_sandboxes:
            sandbox = self.active_sandboxes[sandbox_id]
            sandbox_app_type = self.sandbox_app_types.get(sandbox_id, 'web')  # Default to web if not tracked
            del self.active_sandboxes[sandbox_id]
            
            # Check if we need more warm sandboxes for this app_type
            current_warm_count = len(self.warm_sandboxes[sandbox_app_type])
            if keep_warm and current_warm_count < self.config.min_warm_sandboxes:
                # Reset sandbox state and return to appropriate warm pool
                await self._reset_sandbox(sandbox)
                self.warm_sandboxes[sandbox_app_type].append(sandbox)
                logger.info(f"Sandbox {sandbox_id} ({sandbox_app_type}) returned to warm pool")
            else:
                # Terminate sandbox and remove app_type tracking
                await self._terminate_sandbox(sandbox)
                if sandbox_id in self.sandbox_app_types:
                    del self.sandbox_app_types[sandbox_id]
                logger.info(f"Sandbox {sandbox_id} ({sandbox_app_type}) terminated")
        
        # Update metrics
        if sandbox_id in self.sandbox_metrics:
            del self.sandbox_metrics[sandbox_id]
    
    async def get_pool_status(self) -> Dict:
        """Get current pool status and metrics."""
        active_count = len(self.active_sandboxes)
        warm_web_count = len(self.warm_sandboxes['web'])
        warm_mobile_count = len(self.warm_sandboxes['mobile'])
        warm_count = warm_web_count + warm_mobile_count
        total_count = active_count + warm_count
        
        # Calculate average metrics
        if self.sandbox_metrics:
            avg_response_time = sum(m.avg_response_time for m in self.sandbox_metrics.values()) / len(self.sandbox_metrics)
            avg_memory = sum(m.memory_usage for m in self.sandbox_metrics.values()) / len(self.sandbox_metrics)
            avg_cpu = sum(m.cpu_usage for m in self.sandbox_metrics.values()) / len(self.sandbox_metrics)
        else:
            avg_response_time = avg_memory = avg_cpu = 0.0
        
        return {
            "active_sandboxes": active_count,
            "warm_sandboxes": warm_count,
            "warm_web_sandboxes": warm_web_count,
            "warm_mobile_sandboxes": warm_mobile_count,
            "total_sandboxes": total_count,
            "max_sandboxes": self.config.max_total_sandboxes,
            "utilization": active_count / self.config.max_total_sandboxes,
            "metrics": {
                "avg_response_time": avg_response_time,
                "avg_memory_usage": avg_memory,
                "avg_cpu_usage": avg_cpu
            }
        }
    
    async def _allocate_sandbox(self, user_id: str, project_id: str, app_type: str = 'web') -> AsyncSandbox:
        """Allocate a sandbox from warm pool or create new one."""
        warm_pool = self.warm_sandboxes.get(app_type, [])
        
        if warm_pool:
            # Use warm sandbox of the correct app_type
            sandbox = warm_pool.pop(0)
            self.active_sandboxes[sandbox.id] = sandbox
            self.sandbox_app_types[sandbox.id] = app_type  # Track app_type
            logger.info(f"Allocated warm {app_type} sandbox {sandbox.id} to user {user_id}")
            return sandbox
        else:
            # Create new sandbox with appropriate snapshot based on app_type
            from sandbox.sandbox import create_sandbox_from_snapshot
            from utils.config import config
            
            # Select snapshot based on app_type
            if app_type == 'mobile':
                snapshot_name = config.MOBILE_SANDBOX_SNAPSHOT_NAME
                logger.info(f"Creating mobile sandbox for project {project_id}")
            else:
                snapshot_name = config.SANDBOX_SNAPSHOT_NAME
                logger.info(f"Creating web sandbox for project {project_id}")
            
            sandbox = await create_sandbox_from_snapshot(project_id, snapshot=snapshot_name)
            self.active_sandboxes[sandbox.id] = sandbox
            self.sandbox_app_types[sandbox.id] = app_type  # Track app_type
            
            # Initialize metrics
            self.sandbox_metrics[sandbox.id] = SandboxMetrics(
                created_at=datetime.now(),
                last_used=datetime.now()
            )
            
            logger.info(f"Created new {app_type} sandbox {sandbox.id} for user {user_id}")
            
            # Auto-start dev server for the newly created sandbox
            asyncio.create_task(self._auto_start_dev_server(sandbox, app_type, user_id))
            
            return sandbox
    
    async def _create_sandbox(self, project_id: str, app_type: str = 'web') -> AsyncSandbox:
        """Create a new sandbox with the appropriate snapshot based on app_type."""
        from sandbox.sandbox import create_sandbox_from_snapshot
        from utils.config import config
        
        # Select snapshot based on app_type
        if app_type == 'mobile':
            snapshot_name = config.MOBILE_SANDBOX_SNAPSHOT_NAME
        else:
            snapshot_name = config.SANDBOX_SNAPSHOT_NAME
            
        sandbox = await create_sandbox_from_snapshot(project_id, snapshot=snapshot_name)
        
        # Wait for sandbox to be ready
        await self._wait_for_sandbox_ready(sandbox)
        
        return sandbox
    
    async def _auto_start_dev_server(self, sandbox: AsyncSandbox, app_type: str, user_id: str):
        """Auto-start the development server for a newly created sandbox."""
        try:
            # Wait a bit for the sandbox to fully initialize
            await asyncio.sleep(5)
            
            logger.info(f"Auto-starting {app_type} dev server for sandbox {sandbox.id} (user: {user_id})")
            
            # Import here to avoid circular imports
            from daytona_sdk import SessionExecuteRequest
            
            # Select the appropriate command and working directory
            if app_type == 'mobile':
                command = "cd /workspace/cheatcode-mobile && npm install -g @expo/ngrok@^4.1.0 && npx --yes expo start --max-workers 2 --tunnel"
                cwd = "/workspace/cheatcode-mobile"
            else:
                command = "cd /workspace/cheatcode-app && pnpm run dev"
                cwd = "/workspace/cheatcode-app"
            
            # Create a session specifically for the dev server
            session_name = f"dev_server_{app_type}_auto"
            
            try:
                # Check if dev server is already running (in case of concurrent requests)
                port = 8081 if app_type == 'mobile' else 3000
                check_result = await sandbox.process.exec(
                    f"curl -s http://localhost:{port} -o /dev/null -w '%{{http_code}}' --connect-timeout 2 || echo '000'",
                    timeout=5
                )
                
                if check_result.result.strip() != '000':
                    logger.info(f"Dev server already running on port {port} for sandbox {sandbox.id}, skipping auto-start")
                    return
                
                # Create session and start dev server
                session = await sandbox.process.create_session(session_name)
                
                req = SessionExecuteRequest(
                    command=command,
                    var_async=True,  # Non-blocking
                    cwd=cwd
                )
                
                response = await sandbox.process.execute_session_command(
                    session_id=session.id,
                    req=req
                )
                
                logger.info(f"Successfully started {app_type} dev server for sandbox {sandbox.id} (session: {session.id}, command: {response.cmd_id})")
                
                # Store dev server session info in sandbox metadata (if needed)
                self._track_dev_server_session(sandbox.id, app_type, session.id, response.cmd_id)
                
            except Exception as session_error:
                logger.warning(f"Failed to start dev server session for {app_type} sandbox {sandbox.id}: {session_error}")
                
                # Fallback: try direct command execution
                try:
                    await sandbox.process.exec(command, cwd=cwd, timeout=5)  # Short timeout for fire-and-forget
                    logger.info(f"Started {app_type} dev server via direct execution for sandbox {sandbox.id}")
                except Exception as exec_error:
                    logger.error(f"Failed to start {app_type} dev server for sandbox {sandbox.id}: {exec_error}")
                    
        except Exception as e:
            logger.error(f"Error in auto-start dev server for {app_type} sandbox {sandbox.id}: {e}")
    
    def _track_dev_server_session(self, sandbox_id: str, app_type: str, session_id: str, command_id: str):
        """Track dev server session information for monitoring and cleanup."""
        try:
            # Store dev server info in sandbox metrics for later reference
            if sandbox_id in self.sandbox_metrics:
                self.sandbox_metrics[sandbox_id].dev_server_info = {
                    'app_type': app_type,
                    'session_id': session_id,
                    'command_id': command_id,
                    'started_at': datetime.now()
                }
                logger.debug(f"Tracked dev server session info for sandbox {sandbox_id}")
        except Exception as e:
            logger.warning(f"Failed to track dev server session info: {e}")
    
    async def _wait_for_sandbox_ready(self, sandbox: AsyncSandbox, timeout: int = 60):
        """Wait for sandbox to be in running state."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            if sandbox.state == SandboxState.RUNNING:
                return
            await asyncio.sleep(1)
        
        raise TimeoutError(f"Sandbox {sandbox.id} failed to start within {timeout} seconds")
    
    async def _ensure_warm_sandboxes(self):
        """Ensure we have minimum number of warm sandboxes for both app types."""
        tasks = []
        
        for app_type in ['web', 'mobile']:
            current_count = len(self.warm_sandboxes[app_type])
            needed = self.config.min_warm_sandboxes - current_count
            
            if needed > 0:
                logger.info(f"Warming up {needed} {app_type} sandboxes...")
                
                for i in range(needed):
                    task = asyncio.create_task(
                        self._create_sandbox(f"warm-{app_type}-{i}", app_type)
                    )
                    tasks.append((task, app_type))
        
        if tasks:
            try:
                results = await asyncio.gather(*[task for task, _ in tasks], return_exceptions=True)
                
                for (task, app_type), sandbox in zip(tasks, results):
                    if isinstance(sandbox, AsyncSandbox):
                        self.warm_sandboxes[app_type].append(sandbox)
                        self.sandbox_app_types[sandbox.id] = app_type  # Track app_type for warm sandboxes
                        logger.info(f"Warmed {app_type} sandbox {sandbox.id}")
                    else:
                        logger.error(f"Failed to warm {app_type} sandbox: {sandbox}")
                        
            except Exception as e:
                logger.error(f"Error warming sandboxes: {e}")
    
    async def _reset_sandbox(self, sandbox: AsyncSandbox):
        """Reset sandbox to clean state for reuse."""
        try:
            # Reset to clean cheatcode-app state (sandbox starts in cheatcode-app directory)
            await sandbox.process.exec("git checkout . || true")  # Reset any file changes
            await sandbox.process.exec("git clean -fd || true")   # Remove untracked files
            
            # Reset any running processes
            await sandbox.process.exec("pkill -f 'npm' || true")
            await sandbox.process.exec("pkill -f 'node' || true")
            
        except Exception as e:
            logger.error(f"Error resetting sandbox {sandbox.id}: {e}")
    
    async def _terminate_sandbox(self, sandbox: AsyncSandbox):
        """Terminate a sandbox and clean up resources."""
        try:
            from sandbox.sandbox import delete_sandbox
            await delete_sandbox(sandbox.id)
        except Exception as e:
            logger.error(f"Error terminating sandbox {sandbox.id}: {e}")
    
    async def _cleanup_loop(self):
        """Background task to cleanup idle sandboxes."""
        while True:
            try:
                await asyncio.sleep(self.config.cleanup_interval.total_seconds())
                await self._cleanup_idle_sandboxes()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")
    
    async def _cleanup_idle_sandboxes(self):
        """Clean up sandboxes that have been idle too long."""
        now = datetime.now()
        idle_sandboxes = []
        
        for sandbox_id, metrics in self.sandbox_metrics.items():
            if now - metrics.last_used > self.config.max_idle_time:
                idle_sandboxes.append(sandbox_id)
        
        for sandbox_id in idle_sandboxes:
            if sandbox_id in self.active_sandboxes:
                user_id = self.sandbox_users.get(sandbox_id)
                if user_id:
                    await self.release_sandbox(user_id, keep_warm=False)
                    logger.info(f"Cleaned up idle sandbox {sandbox_id}")
    
    async def _cleanup_all_sandboxes(self):
        """Clean up all sandboxes during shutdown."""
        # Collect all sandboxes from active and both warm pools
        all_sandboxes = list(self.active_sandboxes.values())
        for app_type in ['web', 'mobile']:
            all_sandboxes.extend(self.warm_sandboxes[app_type])
        
        for sandbox in all_sandboxes:
            await self._terminate_sandbox(sandbox)
        
        self.active_sandboxes.clear()
        self.warm_sandboxes['web'].clear()
        self.warm_sandboxes['mobile'].clear()
        self.sandbox_metrics.clear()
        self.user_sandboxes.clear()
        self.sandbox_users.clear()
        self.sandbox_app_types.clear()
    
    async def _check_scaling(self):
        """Check if we need to scale up the pool."""
        utilization = len(self.active_sandboxes) / self.config.max_total_sandboxes
        
        if utilization > self.config.scale_threshold:
            # Scale up warm pool
            await self._ensure_warm_sandboxes()
    
    async def _update_metrics(self, sandbox_id: str, operation: str):
        """Update metrics for a sandbox."""
        if sandbox_id not in self.sandbox_metrics:
            self.sandbox_metrics[sandbox_id] = SandboxMetrics(
                created_at=datetime.now(),
                last_used=datetime.now()
            )
        
        metrics = self.sandbox_metrics[sandbox_id]
        metrics.last_used = datetime.now()
        metrics.total_requests += 1
        
        # Update operation-specific metrics
        if operation == "allocate":
            metrics.active_sessions += 1
        elif operation == "release":
            metrics.active_sessions = max(0, metrics.active_sessions - 1)

# Global pool instance
sandbox_pool = SandboxPool() 