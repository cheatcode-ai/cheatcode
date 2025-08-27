# DEPRECATED: This tool is no longer used in the agent workflow
# The auto-preview system now handles port exposure and URL generation automatically
# Preview URLs are passed directly to the agent context
# This file is kept for reference but should not be imported or used

from agentpress.tool import ToolResult, openapi_schema, xml_schema
from sandbox.tool_base import SandboxToolsBase
from agentpress.thread_manager import ThreadManager
import asyncio
import time

class SandboxExposeTool(SandboxToolsBase):
    """Tool for exposing and retrieving preview URLs for sandbox ports."""

    def __init__(self, project_id: str, thread_manager: ThreadManager):
        super().__init__(project_id, thread_manager)

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "expose_port",
            "description": "Expose a port from the agent's Daytona sandbox environment and get its preview URL. Creates a Daytona preview link that makes services running in the sandbox accessible to users. The preview URL follows the format: https://PORT-sandbox-ID.runner.daytona.work and can be shared with users to access web applications, APIs, or other network services.",
            "parameters": {
                "type": "object",
                "properties": {
                    "port": {
                        "type": "integer",
                        "description": "The port number to expose. Must be between 3000-9999 (Daytona preview link range).",
                        "minimum": 3000,
                        "maximum": 9999
                    }
                },
                "required": ["port"]
            }
        }
    })
    @xml_schema(
        tag_name="expose-port",
        mappings=[
            {"param_name": "port", "node_type": "content", "path": "."}
        ],
        example='''
        <!-- Example 1: Expose a web server running on port 8000 -->
        <function_calls>
        <invoke name="expose_port">
        <parameter name="port">8000</parameter>
        </invoke>
        </function_calls>

        <!-- Example 2: Expose an API service running on port 3000 -->
        <function_calls>
        <invoke name="expose_port">
        <parameter name="port">3000</parameter>
        </invoke>
        </function_calls>

        <!-- Example 3: Expose a development server running on port 5173 -->
        <function_calls>
        <invoke name="expose_port">
        <parameter name="port">5173</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def expose_port(self, port: int) -> ToolResult:
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()
            
            # Convert port to integer if it's a string
            port = int(port)
            
            # Validate port number - Daytona supports ports 3000-9999 for preview links
            if not 3000 <= port <= 9999:
                return self.fail_response(f"Invalid port number: {port}. Daytona preview links support ports 3000-9999.")

            # For port 3000 (Next.js dev server), wait a moment and check if it's ready
            if port == 3000:
                try:
                    # Wait a bit and check if Next.js server is responding
                    await asyncio.sleep(2)  # Give server time to start
                    health_check = await self.sandbox.process.exec("curl -s http://localhost:3000 -o /dev/null -w '%{http_code}' || echo '000'", timeout=10)
                    if health_check.result.strip() == '000':
                        return self.fail_response(f"Development server on port {port} is not responding yet. Please wait for 'npm run dev' to complete startup, then try exposing the port again.")
                except Exception:
                    # If health check fails, proceed anyway
                    pass
            
            # Check if something is actually listening on the port (for custom ports)
            elif port not in [8000, 8003]:  # Skip check for known API ports
                try:
                    port_check = await self.sandbox.process.exec(f"netstat -tlnp | grep :{port}", timeout=5)
                    if port_check.exit_code != 0:
                        return self.fail_response(f"No service is currently listening on port {port}. Please start a service on this port first.")
                except Exception:
                    # If we can't check, proceed anyway - the user might be starting a service
                    pass

            # Get the preview link for the specified port using Daytona SDK
            preview_info = await self.sandbox.get_preview_link(port)
            
            # Extract URL and token according to Daytona documentation
            url = preview_info.url if hasattr(preview_info, 'url') else str(preview_info)
            token = getattr(preview_info, 'token', None)
            
            response_data = {
                "url": url,
                "port": port,
                "message": f"✅ Successfully exposed port {port}!\n\n🌐 **Preview URL**: {url}\n\n📱 Click the URL above to view your application in the browser."
            }
            
            # Include token for programmatic access if available
            if token:
                response_data["token"] = token
                response_data["message"] += f"\n\n🔑 For API access: curl -H \"x-daytona-preview-token: {token}\" {url}"
            
            return self.success_response(response_data)
                
        except ValueError:
            return self.fail_response(f"Invalid port number: {port}. Must be a valid integer between 3000 and 9999.")
        except Exception as e:
            return self.fail_response(f"Error exposing port {port}: {str(e)}")
