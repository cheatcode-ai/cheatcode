"""
Development server management with race condition protection.
"""

import asyncio
import json
import time
from typing import Dict, Optional, Tuple, List
from dataclasses import dataclass
from enum import Enum
from utils.logger import logger
from services import redis

class DevServerType(Enum):
    WEB = "web"
    MOBILE = "mobile"
    UNKNOWN = "unknown"

class DevServerStatus(Enum):
    NOT_RUNNING = "not_running"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    FAILED = "failed"

@dataclass
class DevServerInfo:
    """Information about a running development server."""
    server_type: DevServerType
    port: int
    command: str
    session_name: str
    sandbox_id: str
    started_at: float
    status: DevServerStatus
    process_id: Optional[str] = None
    
    def to_dict(self) -> Dict:
        return {
            'server_type': self.server_type.value,
            'port': self.port,
            'command': self.command,
            'session_name': self.session_name,
            'sandbox_id': self.sandbox_id,
            'started_at': self.started_at,
            'status': self.status.value,
            'process_id': self.process_id
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'DevServerInfo':
        return cls(
            server_type=DevServerType(data['server_type']),
            port=data['port'],
            command=data['command'],
            session_name=data['session_name'],
            sandbox_id=data['sandbox_id'],
            started_at=data['started_at'],
            status=DevServerStatus(data['status']),
            process_id=data.get('process_id')
        )

class DevServerManager:
    """Manages development servers with race condition protection."""
    
    # Default ports for different server types
    DEFAULT_PORTS = {
        DevServerType.WEB: 3000,
        DevServerType.MOBILE: 8081,
    }
    
    # Common development server commands
    DEV_COMMANDS = {
        DevServerType.WEB: [
            'pnpm run dev', 'pnpm dev', 'npm run dev', 'npm start',
            'yarn dev', 'yarn start', 'next dev'
        ],
        DevServerType.MOBILE: [
            'npx expo start', 'expo start', 'npx expo start --port 8081',
            'expo start --port 8081', 'react-native start'
        ]
    }
    
    def __init__(self, sandbox_id: str):
        self.sandbox_id = sandbox_id
        
    def detect_server_type(self, command: str, app_type: Optional[str] = None) -> DevServerType:
        """Detect the type of development server from command."""
        command_lower = command.lower().strip()
        
        # Use app_type hint if provided
        if app_type == 'mobile':
            return DevServerType.MOBILE
        elif app_type == 'web':
            return DevServerType.WEB
            
        # Detect from command patterns
        for server_type, commands in self.DEV_COMMANDS.items():
            if any(cmd.lower() in command_lower for cmd in commands):
                return server_type
                
        # Fallback detection
        if any(pattern in command_lower for pattern in ['expo', 'react-native', 'metro']):
            return DevServerType.MOBILE
        elif any(pattern in command_lower for pattern in ['next', 'react', 'vite']):
            return DevServerType.WEB
            
        return DevServerType.UNKNOWN
    
    def get_default_port(self, server_type: DevServerType) -> int:
        """Get default port for server type."""
        return self.DEFAULT_PORTS.get(server_type, 3000)
    
    async def acquire_dev_server_lock(
        self, 
        server_type: DevServerType, 
        timeout: int = 60
    ) -> Tuple[bool, Optional[str]]:
        """
        Acquire a distributed lock for starting a dev server.
        Returns (success, existing_server_info)
        """
        lock_key = f"dev_server_lock:{self.sandbox_id}:{server_type.value}"
        lock_value = f"{time.time()}:{asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'}"
        
        try:
            # Try to acquire lock
            acquired = await redis.set(lock_key, lock_value, nx=True, ex=timeout)
            
            if acquired:
                logger.debug(f"Acquired dev server lock for {server_type.value} on sandbox {self.sandbox_id}")
                return True, None
            else:
                # Check if there's already a running server
                server_info = await self.get_dev_server_info(server_type)
                if server_info and server_info.status == DevServerStatus.RUNNING:
                    return False, f"Dev server already running: {server_info.command} on port {server_info.port}"
                else:
                    return False, "Another dev server start operation is in progress"
                    
        except Exception as e:
            logger.error(f"Error acquiring dev server lock: {e}")
            return False, f"Lock acquisition failed: {e}"
    
    async def release_dev_server_lock(self, server_type: DevServerType) -> None:
        """Release the development server lock."""
        lock_key = f"dev_server_lock:{self.sandbox_id}:{server_type.value}"
        
        try:
            await redis.delete(lock_key)
            logger.debug(f"Released dev server lock for {server_type.value} on sandbox {self.sandbox_id}")
        except Exception as e:
            logger.warning(f"Error releasing dev server lock: {e}")
    
    async def register_dev_server(
        self,
        server_type: DevServerType,
        port: int,
        command: str,
        session_name: str,
        process_id: Optional[str] = None
    ) -> DevServerInfo:
        """Register a new development server."""
        server_info = DevServerInfo(
            server_type=server_type,
            port=port,
            command=command,
            session_name=session_name,
            sandbox_id=self.sandbox_id,
            started_at=time.time(),
            status=DevServerStatus.STARTING,
            process_id=process_id
        )
        
        # Store in Redis
        registry_key = f"dev_server_registry:{self.sandbox_id}:{server_type.value}"
        
        try:
            await redis.set(
                registry_key,
                json.dumps(server_info.to_dict()),
                ex=3600  # 1 hour TTL
            )
            logger.info(f"Registered {server_type.value} dev server on port {port} for sandbox {self.sandbox_id}")
            return server_info
        except Exception as e:
            logger.error(f"Error registering dev server: {e}")
            raise
    
    async def update_dev_server_status(
        self, 
        server_type: DevServerType, 
        status: DevServerStatus
    ) -> None:
        """Update the status of a development server."""
        registry_key = f"dev_server_registry:{self.sandbox_id}:{server_type.value}"
        
        try:
            # Get current info
            server_data = await redis.get(registry_key)
            if server_data:
                server_info = DevServerInfo.from_dict(json.loads(server_data))
                server_info.status = status
                
                # Update in Redis
                await redis.set(
                    registry_key,
                    json.dumps(server_info.to_dict()),
                    ex=3600
                )
                logger.debug(f"Updated {server_type.value} dev server status to {status.value}")
        except Exception as e:
            logger.error(f"Error updating dev server status: {e}")
    
    async def get_dev_server_info(self, server_type: DevServerType) -> Optional[DevServerInfo]:
        """Get information about a development server."""
        registry_key = f"dev_server_registry:{self.sandbox_id}:{server_type.value}"
        
        try:
            server_data = await redis.get(registry_key)
            if server_data:
                return DevServerInfo.from_dict(json.loads(server_data))
            return None
        except Exception as e:
            logger.error(f"Error getting dev server info: {e}")
            return None
    
    async def check_port_availability(self, sandbox, port: int) -> bool:
        """Check if a port is available."""
        try:
            # Try to connect to the port
            result = await sandbox.process.exec(
                f"curl -s http://localhost:{port} -o /dev/null -w '%{{http_code}}' --connect-timeout 1 --max-time 2 || echo '000'",
                timeout=5
            )
            
            # Port is available if connection fails (returns 000)
            return result.result.strip() == '000'
        except Exception:
            # If curl fails, assume port is available
            return True
    
    async def find_available_port(self, sandbox, preferred_port: int, port_range: int = 10) -> int:
        """Find an available port starting from preferred_port."""
        for port in range(preferred_port, preferred_port + port_range):
            if await self.check_port_availability(sandbox, port):
                return port
        
        raise Exception(f"No available ports found in range {preferred_port}-{preferred_port + port_range}")
    
    async def verify_server_health(self, sandbox, port: int, max_attempts: int = 30) -> bool:
        """Verify that a development server is healthy and responding."""
        logger.info(f"Verifying dev server health on port {port}")
        
        for attempt in range(max_attempts):
            try:
                # Check if server is responding
                result = await sandbox.process.exec(
                    f"curl -s http://localhost:{port} -o /dev/null -w '%{{http_code}}' --connect-timeout 2 --max-time 5",
                    timeout=10
                )
                
                http_code = result.result.strip()
                
                # Accept any HTTP response (2xx, 3xx, 4xx) as healthy
                if http_code and http_code != '000' and len(http_code) == 3:
                    logger.info(f"Dev server healthy on port {port} (HTTP {http_code})")
                    return True
                    
                # Wait before next attempt
                if attempt < max_attempts - 1:
                    wait_time = min(2, 0.5 + (attempt * 0.1))  # Progressive backoff
                    await asyncio.sleep(wait_time)
                    
            except Exception as e:
                logger.debug(f"Health check attempt {attempt + 1} failed: {e}")
                if attempt < max_attempts - 1:
                    await asyncio.sleep(1)
        
        logger.warning(f"Dev server health check failed after {max_attempts} attempts on port {port}")
        return False
    
    async def get_running_servers(self) -> List[DevServerInfo]:
        """Get all running development servers for this sandbox."""
        servers = []
        
        for server_type in DevServerType:
            if server_type == DevServerType.UNKNOWN:
                continue
                
            server_info = await self.get_dev_server_info(server_type)
            if server_info and server_info.status in [DevServerStatus.STARTING, DevServerStatus.RUNNING]:
                servers.append(server_info)
        
        return servers
    
    async def stop_dev_server(self, server_type: DevServerType, sandbox) -> bool:
        """Stop a development server."""
        server_info = await self.get_dev_server_info(server_type)
        if not server_info:
            return False
        
        try:
            # Update status to stopping
            await self.update_dev_server_status(server_type, DevServerStatus.STOPPING)
            
            # Try to terminate the session
            try:
                await sandbox.process.terminate_session(server_info.session_name)
            except Exception as e:
                logger.warning(f"Error terminating session {server_info.session_name}: {e}")
                
                # Try to kill processes on the port
                try:
                    await sandbox.process.exec(
                        f"pkill -f 'localhost:{server_info.port}' || true",
                        timeout=10
                    )
                    await sandbox.process.exec(
                        f"lsof -ti:{server_info.port} | xargs kill -9 || true",
                        timeout=10
                    )
                except Exception as kill_error:
                    logger.warning(f"Error killing processes on port {server_info.port}: {kill_error}")
            
            # Remove from registry
            registry_key = f"dev_server_registry:{self.sandbox_id}:{server_type.value}"
            await redis.delete(registry_key)
            
            logger.info(f"Stopped {server_type.value} dev server on port {server_info.port}")
            return True
            
        except Exception as e:
            logger.error(f"Error stopping dev server: {e}")
            return False
    
    async def cleanup_all_servers(self, sandbox) -> None:
        """Clean up all development servers for this sandbox."""
        running_servers = await self.get_running_servers()
        
        cleanup_tasks = []
        for server_info in running_servers:
            task = asyncio.create_task(
                self.stop_dev_server(server_info.server_type, sandbox)
            )
            cleanup_tasks.append(task)
        
        if cleanup_tasks:
            try:
                await asyncio.gather(*cleanup_tasks, return_exceptions=True)
                logger.info(f"Cleaned up {len(cleanup_tasks)} dev servers for sandbox {self.sandbox_id}")
            except Exception as e:
                logger.error(f"Error during dev server cleanup: {e}")