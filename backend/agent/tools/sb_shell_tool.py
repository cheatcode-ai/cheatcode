import asyncio
from typing import Optional, Dict, Any, List
import time
import asyncio
from uuid import uuid4
from agentpress.tool import ToolResult, ToolSchema, SchemaType, XMLTagSchema, XMLNodeMapping
from sandbox.tool_base import SandboxToolsBase
from agentpress.thread_manager import ThreadManager

class SandboxShellTool(SandboxToolsBase):
    """Tool for executing tasks in a Daytona sandbox using the Daytona SDK process APIs. 
    Uses Daytona sessions for maintaining state between commands and provides comprehensive process management."""

    def __init__(self, project_id: str, thread_manager: ThreadManager, app_type: str = 'web'):
        super().__init__(project_id, thread_manager, app_type)
        self._sessions: Dict[str, str] = {}  # Maps session names to session IDs
        # workspace_path is inherited from base class and points to the correct workspace directory

    def get_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Override base class to provide dynamic schemas based on app_type."""
        return self.get_tool_schemas()
    
    def get_tool_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Generate dynamic tool schemas based on app_type context."""
        
        # Determine context-appropriate examples and descriptions
        if self.app_type == 'mobile':
            # Expo React Native examples from official documentation
            dev_command_example = "npx expo start"
            install_command_example = "npx expo install expo-camera"
            build_command_example = "npx expo prebuild"
            test_command_example = "npx expo run:ios"
            folder_example = "components"
            dev_session_name = "expo_dev"
        else:
            # React/Next.js examples with pnpm (preferred package manager)
            dev_command_example = "pnpm run dev"
            install_command_example = "pnpm install axios"
            build_command_example = "pnpm run build"
            test_command_example = "pnpm test"
            folder_example = "src/components"
            dev_session_name = "dev_server"

        schemas = {}
        
        # execute_command schema
        schemas["execute_command"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "execute_command",
                        "description": "Execute a shell command in the workspace directory. IMPORTANT: Commands are non-blocking by default and run in a session. This is ideal for long-running operations like starting servers or development processes. Uses sessions to maintain state between commands. This tool is essential for running CLI tools and managing system operations.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "command": {
                                    "type": "string",
                                    "description": "The shell command to execute. Use this for running CLI tools or system operations. Commands can be chained using &&, ||, and | operators."
                                },
                                "folder": {
                                    "type": "string",
                                    "description": f"Optional relative path to a subdirectory of the workspace where the command should be executed. Example: '{folder_example}'"
                                },
                                "session_name": {
                                    "type": "string",
                                    "description": "Optional name of the Daytona session to use. Use named sessions for related commands that need to maintain state. Defaults to a random session name."
                                },
                                "blocking": {
                                    "type": "boolean",
                                    "description": "Whether to wait for the command to complete. Defaults to false for non-blocking execution.",
                                    "default": False
                                },
                                "timeout": {
                                    "type": "integer",
                                    "description": "Optional timeout in seconds for blocking commands. Defaults to 60. Ignored for non-blocking commands.",
                                    "default": 60
                                }
                            },
                            "required": ["command"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="execute-command",
                    mappings=[
                        XMLNodeMapping(param_name="command", node_type="content", path="."),
                        XMLNodeMapping(param_name="folder", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="session_name", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="blocking", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="timeout", node_type="attribute", path=".", required=False)
                    ],
                    example=f'''
        <function_calls>
        <invoke name="execute_command">
        <parameter name="command">{dev_command_example}</parameter>
        <parameter name="session_name">{dev_session_name}</parameter>
        </invoke>
        </function_calls>

        <!-- Example 2: Install Package -->
        <function_calls>
        <invoke name="execute_command">
        <parameter name="command">{install_command_example}</parameter>
        </invoke>
        </function_calls>
        '''
                )
            )
        ]

        # check_command_output schema
        schemas["check_command_output"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "check_command_output",
                        "description": "Check the output and status of a previously executed command in a Daytona session. Use this to monitor the progress or results of non-blocking commands.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "session_name": {
                                    "type": "string",
                                    "description": "The name of the session to check."
                                },
                                "kill_session": {
                                    "type": "boolean",
                                    "description": "Whether to terminate the session after checking. Set to true when you're done with the command.",
                                    "default": False
                                }
                            },
                            "required": ["session_name"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="check-command-output",
                    mappings=[
                        XMLNodeMapping(param_name="session_name", node_type="attribute", path=".", required=True),
                        XMLNodeMapping(param_name="kill_session", node_type="attribute", path=".", required=False)
                    ],
                    example=f'''
        <function_calls>
        <invoke name="check_command_output">
        <parameter name="session_name">{dev_session_name}</parameter>
        </invoke>
        </function_calls>
        
        <!-- Example 2: Check final output and kill session -->
        <function_calls>
        <invoke name="check_command_output">
        <parameter name="session_name">{dev_session_name}</parameter>
        <parameter name="kill_session">true</parameter>
        </invoke>
        </function_calls>
        '''
                )
            )
        ]

        # terminate_command schema
        schemas["terminate_command"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "terminate_command",
                        "description": "Terminate a running command by deleting its Daytona session.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "session_name": {
                                    "type": "string",
                                    "description": "The name of the session to terminate."
                                }
                            },
                            "required": ["session_name"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="terminate-command",
                    mappings=[
                        XMLNodeMapping(param_name="session_name", node_type="attribute", path=".", required=True)
                    ],
                    example=f'''
        <function_calls>
        <invoke name="terminate_command">
        <parameter name="session_name">{dev_session_name}</parameter>
        </invoke>
        </function_calls>
        '''
                )
            )
        ]

        # list_commands schema
        schemas["list_commands"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "list_commands",
                        "description": "List all active Daytona sessions managed by this tool.",
                        "parameters": {
                            "type": "object",
                            "properties": {}
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="list-commands",
                    mappings=[],
                    example='''
        <function_calls>
        <invoke name="list_commands">
        </invoke>
        </function_calls>
        '''
                )
            )
        ]
        
        return schemas

    async def _ensure_session(self, session_name: str = "default") -> str:
        """Ensure a session exists and return its ID with atomic creation for dev servers."""
        if session_name not in self._sessions:
            # Special handling for dev server sessions to prevent duplicates
            if session_name.startswith('dev_server_'):
                from services import redis
                session_lock_key = f"session_create:{self.sandbox.id}:{session_name}"
                session_lock_value = f"{time.time()}:{asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'}"
                
                # Try to acquire session creation lock
                session_lock_acquired = await redis.set(session_lock_key, session_lock_value, nx=True, ex=30)
                
                if not session_lock_acquired:
                    # Wait briefly for other creation to complete, then check if session exists
                    await asyncio.sleep(0.5)
                    if session_name in self._sessions:
                        return self._sessions[session_name]
                
                try:
                    # Double-check if session was created by another process
                    if session_name in self._sessions:
                        return self._sessions[session_name]
                        
                    # Create new session with unique ID
                    session_id = str(uuid4())
                    await self._ensure_sandbox()
                    await self.sandbox.process.create_session(session_id)
                    self._sessions[session_name] = session_id
                    logger.debug(f"Created new dev server session: {session_name} -> {session_id}")
                    
                finally:
                    # Release session creation lock
                    if session_lock_acquired:
                        try:
                            await redis.delete(session_lock_key)
                        except Exception:
                            pass
            else:
                # Regular session creation for non-dev commands
                session_id = str(uuid4())
                try:
                    await self._ensure_sandbox()
                    await self.sandbox.process.create_session(session_id)
                    self._sessions[session_name] = session_id
                except Exception as e:
                    raise RuntimeError(f"Failed to create session: {str(e)}")
                    
        return self._sessions[session_name]

    async def _cleanup_session(self, session_name: str):
        """Clean up a session if it exists with enhanced process cleanup."""
        if session_name in self._sessions:
            try:
                await self._ensure_sandbox()
                
                # For dev server sessions, try to gracefully stop processes first
                if session_name.startswith('dev_server_'):
                    try:
                        port = 8081 if self.app_type == 'mobile' else 3000
                        
                        # Send SIGTERM to processes using the port
                        await self.sandbox.process.exec(
                            f"lsof -ti:{port} | head -5 | xargs -r kill -TERM 2>/dev/null || true",
                            timeout=5
                        )
                        
                        # Wait a moment for graceful shutdown
                        await asyncio.sleep(2)
                        
                        # Force kill any remaining processes
                        await self.sandbox.process.exec(
                            f"lsof -ti:{port} | head -5 | xargs -r kill -9 2>/dev/null || true",
                            timeout=5
                        )
                        
                        logger.debug(f"Cleaned up dev server processes on port {port}")
                        
                    except Exception as process_cleanup_error:
                        logger.warning(f"Error during dev server process cleanup: {process_cleanup_error}")
                
                # Delete the session
                await self.sandbox.process.delete_session(self._sessions[session_name])
                del self._sessions[session_name]
                logger.debug(f"Cleaned up session: {session_name}")
                
            except Exception as e:
                logger.warning(f"Failed to cleanup session {session_name}: {str(e)}")
                # Remove from tracking even if cleanup failed
                if session_name in self._sessions:
                    del self._sessions[session_name]


    async def execute_command(
        self, 
        command: str, 
        folder: Optional[str] = None,
        session_name: Optional[str] = None,
        blocking: bool = False,
        timeout: int = 60
    ) -> ToolResult:
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()
            
            # Thread-safe dev server detection with distributed locking
            if self._is_dev_server_command(command):
                dev_server_lock_key = f"dev_server_start:{self.sandbox.id}:{self.app_type}"
                lock_value = f"{time.time()}:{asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'}"
                
                # Import Redis here to avoid circular imports
                from services import redis
                
                # Try to acquire distributed lock for dev server startup
                lock_acquired = await redis.set(dev_server_lock_key, lock_value, nx=True, ex=60)
                
                if not lock_acquired:
                    # Another instance is starting or server is running, check status
                    existing_status = await self._check_dev_server_status()
                    if existing_status == 'running':
                        return self.success_response({
                            "output": "Development server is already running in existing session. No need to start a new one.\nPreview loads automatically in the preview panel.",
                            "exit_code": 0,
                            "cwd": self.workspace_path,
                            "completed": True,
                            "success": True,
                            "skipped_redundant_startup": True
                        })
                    else:
                        return self.success_response({
                            "output": "Another dev server startup is in progress. Please wait and check session status.",
                            "exit_code": 0,
                            "cwd": self.workspace_path,
                            "completed": True,
                            "success": True,
                            "skipped_concurrent_startup": True
                        })
                
                try:
                    # Double-check after acquiring lock
                    existing_status = await self._check_dev_server_status()
                    if existing_status == 'running':
                        return self.success_response({
                            "output": "Development server is already running. No need to start a new one.\nPreview loads automatically in the preview panel.",
                            "exit_code": 0,
                            "cwd": self.workspace_path,
                            "completed": True,
                            "success": True,
                            "skipped_redundant_startup": True
                        })
                    
                    # Continue to server startup (lock cleanup in finally block below)
                    
                except Exception as dev_check_error:
                    logger.error(f"Error during dev server status check: {dev_check_error}")
                    # Release lock and continue with normal execution
                    try:
                        current_lock = await redis.get(dev_server_lock_key)
                        if current_lock == lock_value:
                            await redis.delete(dev_server_lock_key)
                    except Exception:
                        pass
            
            # Set up working directory
            cwd = self.workspace_path
            if folder:
                folder = folder.strip('/')
                cwd = f"{self.workspace_path}/{folder}"
            
            if blocking:
                # For blocking execution, use direct process.exec
                try:
                    response = await self.sandbox.process.exec(
                        command=command,
                        cwd=cwd,
                        timeout=timeout
                    )
                    
                    return self.success_response({
                        "output": response.result,
                        "exit_code": response.exit_code,
                        "cwd": cwd,
                        "completed": True,
                        "success": response.exit_code == 0
                    })
                    
                except Exception as e:
                    return self.fail_response(f"Error executing blocking command: {str(e)}")
            else:
                # For non-blocking execution, use session-based approach with collision protection
                if not session_name:
                    # Use predictable session name for dev servers to prevent duplicates
                    if self._is_dev_server_command(command):
                        session_name = f"dev_server_{self.app_type}"
                    else:
                        session_name = f"session_{str(uuid4())[:8]}"
                
                # Ensure session exists (with atomic creation for dev servers)
                session_id = await self._ensure_session(session_name)
                
                # Execute command in session (non-blocking)
                from daytona_sdk import SessionExecuteRequest
                req = SessionExecuteRequest(
                    command=command,
                    var_async=True,  # Non-blocking
                    cwd=cwd
                )
                
                response = await self.sandbox.process.execute_session_command(
                    session_id=session_id,
                    req=req
                )
                
                # For dev server commands, add cleanup and lock release
                result = self.success_response({
                    "session_name": session_name,
                    "session_id": session_id,
                    "command_id": response.cmd_id,
                    "cwd": cwd,
                    "message": f"Command started in session '{session_name}'. Use check_command_output to view results.",
                    "completed": False
                })
                
                # Release dev server lock if this was a dev server command
                if self._is_dev_server_command(command):
                    try:
                        dev_server_lock_key = f"dev_server_start:{self.sandbox.id}:{self.app_type}"
                        lock_value = f"{time.time()}:{asyncio.current_task().get_name() if asyncio.current_task() else 'unknown'}"
                        current_lock = await redis.get(dev_server_lock_key)
                        # Only delete if we still own a lock (value format might have changed)
                        if current_lock and any(part in current_lock for part in [str(time.time())[:8], asyncio.current_task().get_name() if asyncio.current_task() else 'unknown']):
                            await redis.delete(dev_server_lock_key)
                            logger.debug(f"Released dev server lock after successful startup")
                    except Exception as cleanup_error:
                        logger.warning(f"Failed to release dev server lock after startup: {cleanup_error}")
                
                return result
                
        except Exception as e:
            return self.fail_response(f"Error executing command: {str(e)}")




    async def check_command_output(
        self,
        session_name: str,
        kill_session: bool = False
    ) -> ToolResult:
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()
            
            # Check if session exists in our tracking
            if session_name not in self._sessions:
                return self.fail_response(f"Session '{session_name}' does not exist or was not created by this tool.")
            
            session_id = self._sessions[session_name]
            
            # Get session information and command logs
            try:
                session = await self.sandbox.process.get_session(session_id)
            
                # Get logs for all commands in the session
                all_output = []
                for command in session.commands:
                    try:
                        logs = await self.sandbox.process.get_session_command_logs(
                            session_id=session_id,
                            command_id=command.id
                        )
                        all_output.append(f"Command: {command.command}")
                        all_output.append(f"Exit Code: {command.exit_code}")
                        all_output.append(f"Output: {logs}")
                        all_output.append("---")
                    except Exception as e:
                        all_output.append(f"Error getting logs for command {command.id}: {str(e)}")
                
                output = "\n".join(all_output)

                # Kill session if requested
                if kill_session:
                    await self._cleanup_session(session_name)
                    termination_status = "Session terminated."
                else:
                    termination_status = "Session still running."

                return self.success_response({
                    "output": output,
                    "session_name": session_name,
                    "session_id": session_id,
                    "status": termination_status,
                    "commands_count": len(session.commands)
                })

            except Exception as e:
                return self.fail_response(f"Error getting session logs: {str(e)}")
                
        except Exception as e:
            return self.fail_response(f"Error checking command output: {str(e)}")


    async def terminate_command(
        self,
        session_name: str
    ) -> ToolResult:
        try:
            # Check if session exists in our tracking
            if session_name not in self._sessions:
                return self.fail_response(f"Session '{session_name}' does not exist or was not created by this tool.")
            
            # Clean up the session
            await self._cleanup_session(session_name)
            
            return self.success_response({
                "message": f"Session '{session_name}' terminated successfully."
            })
                
        except Exception as e:
            return self.fail_response(f"Error terminating command: {str(e)}")


    async def list_commands(self) -> ToolResult:
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()
            
            if not self._sessions:
                return self.success_response({
                    "message": "No active sessions found.",
                    "sessions": []
                })
            
            # Get detailed session information
            sessions_info = []
            for session_name, session_id in self._sessions.items():
                try:
                    session = await self.sandbox.process.get_session(session_id)
                    sessions_info.append({
                        "name": session_name,
                        "id": session_id,
                        "commands_count": len(session.commands),
                        "commands": [{"command": cmd.command, "exit_code": cmd.exit_code} for cmd in session.commands]
                    })
                except Exception as e:
                    sessions_info.append({
                        "name": session_name,
                        "id": session_id,
                        "error": f"Failed to get session info: {str(e)}"
                    })
            
            return self.success_response({
                "message": f"Found {len(sessions_info)} active sessions.",
                "sessions": sessions_info
            })
                
        except Exception as e:
            return self.fail_response(f"Error listing commands: {str(e)}")

    def _is_dev_server_command(self, command: str) -> bool:
        """Check if the command is trying to start a development server."""
        command_lower = command.lower().strip()
        dev_server_patterns = [
            'pnpm run dev',
            'npm run dev', 
            'yarn dev',
            'next dev',
            'npm start',
            'pnpm start',
            'pnpm dev',
            'expo start',
            'npx expo start',
            'npx expo start --port',  # Include port-specific expo commands
            'expo start --port',
            'yarn start',
            'react-native start',
            'metro start'  # Metro bundler for React Native
        ]
        return any(pattern in command_lower for pattern in dev_server_patterns)
    
    async def _check_dev_server_status(self) -> str:
        """Check if a dev server is already running. Returns: 'running', 'session_exists', or 'not_running'"""
        try:
            # Check if dev_server session exists (updated to match new naming)
            dev_session_name = f'dev_server_{self.app_type}'
            if dev_session_name in self._sessions:
                # Check if the session is still active and has running processes
                session_id = self._sessions[dev_session_name]
                try:
                    session = await self.sandbox.process.get_session(session_id)
                    if session.commands:
                        # Check if dev server is responding on appropriate port based on app_type
                        port = 8081 if self.app_type == 'mobile' else 3000
                        port_check = await self.sandbox.process.exec(
                            f"curl -s http://localhost:{port} -o /dev/null -w '%{{http_code}}' --connect-timeout 2 || echo '000'", 
                            timeout=5
                        )
                        
                        if port_check.result.strip() != '000':
                            return 'running'
                        else:
                            return 'session_exists'  # Session exists but server not responding
                except Exception:
                    return 'session_exists'  # Session exists but can't check status
            
            # No dev_server session found, check if appropriate port is responding anyway
            try:
                port = 8081 if self.app_type == 'mobile' else 3000
                port_check = await self.sandbox.process.exec(
                    f"curl -s http://localhost:{port} -o /dev/null -w '%{{http_code}}' --connect-timeout 2 || echo '000'", 
                    timeout=5
                )
                if port_check.result.strip() != '000':
                    return 'running'
            except Exception:
                pass
                
            return 'not_running'
            
        except Exception:
            return 'not_running'

    async def cleanup(self):
        """Clean up all sessions with improved error handling."""
        cleanup_tasks = []
        
        for session_name in list(self._sessions.keys()):
            task = asyncio.create_task(self._cleanup_session(session_name))
            cleanup_tasks.append(task)
        
        if cleanup_tasks:
            try:
                # Wait for all cleanup tasks with timeout
                await asyncio.wait_for(
                    asyncio.gather(*cleanup_tasks, return_exceptions=True),
                    timeout=30
                )
                logger.debug(f"Cleaned up {len(cleanup_tasks)} sessions")
            except asyncio.TimeoutError:
                logger.warning(f"Session cleanup timed out, some sessions may not be properly terminated")
            except Exception as e:
                logger.error(f"Error during session cleanup: {e}")