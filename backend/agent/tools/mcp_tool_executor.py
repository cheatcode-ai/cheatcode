import json
import asyncio
from typing import Dict, Any
from agentpress.tool import ToolResult
from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client
from mcp_service.client import MCPManager
from utils.logger import logger


class MCPToolExecutor:
    def __init__(self, mcp_manager: MCPManager, custom_tools: Dict[str, Dict[str, Any]], tool_wrapper=None):
        self.mcp_manager = mcp_manager
        self.custom_tools = custom_tools
        self.tool_wrapper = tool_wrapper
    
    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        logger.info(f"Executing MCP tool {tool_name} with arguments {arguments}")
        
        try:
            if tool_name in self.custom_tools:
                return await self._execute_custom_tool(tool_name, arguments)
            else:
                return await self._execute_standard_tool(tool_name, arguments)
        except Exception as e:
            logger.error(f"Error executing MCP tool {tool_name}: {str(e)}")
            return self._create_error_result(f"Error executing tool: {str(e)}")
    
    async def _execute_standard_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        result = await self.mcp_manager.execute_tool(tool_name, arguments)
        
        if isinstance(result, dict):
            if result.get('isError', False):
                return self._create_error_result(result.get('content', 'Tool execution failed'))
            else:
                return self._create_success_result(result.get('content', result))
        else:
            return self._create_success_result(result)
    
    async def _execute_custom_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        tool_info = self.custom_tools[tool_name]
        custom_type = tool_info['custom_type']
        
        if custom_type == 'composio':
            return await self._execute_composio_tool(tool_name, arguments, tool_info)
        elif custom_type == 'sse':
            return await self._execute_sse_tool(tool_name, arguments, tool_info)
        elif custom_type == 'http':
            return await self._execute_http_tool(tool_name, arguments, tool_info)
        elif custom_type == 'json':
            return await self._execute_json_tool(tool_name, arguments, tool_info)
        else:
            return self._create_error_result(f"Unsupported custom MCP type: {custom_type}")
    
    async def _execute_composio_tool(self, tool_name: str, arguments: Dict[str, Any], tool_info: Dict[str, Any]) -> ToolResult:
        """Execute a tool via Composio MCP server."""
        import os
        import httpx

        custom_config = tool_info['custom_config']
        original_tool_name = tool_info['original_name']

        app_slug = custom_config.get('app_slug') or custom_config.get('qualified_name')
        api_key = custom_config.get('api_key') or os.getenv('COMPOSIO_API_KEY')

        if not api_key:
            return self._create_error_result("No Composio API key available")

        if not app_slug:
            return self._create_error_result("No app_slug available for Composio tool")

        connected_account_id = custom_config.get('connected_account_id')
        external_user_id = await self._resolve_external_user_id(custom_config)

        try:
            # Use stored MCP URL from initialization, or fetch it via API
            mcp_url = custom_config.get('mcp_url')

            if not mcp_url:
                # Fetch MCP URL via Composio REST API
                COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3"
                api_headers = {
                    "x-api-key": api_key,
                    "Content-Type": "application/json"
                }

                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.get(
                        f"{COMPOSIO_API_BASE}/mcp/servers",
                        headers=api_headers
                    )

                    if response.status_code == 200:
                        data = response.json()
                        servers = data.get('items', [])

                        for server in servers:
                            if app_slug.lower() in [t.lower() for t in server.get('toolkits', [])]:
                                mcp_url = server.get('mcp_url')
                                if mcp_url:
                                    logger.info(f"Found MCP server URL for {app_slug}")
                                    break

                if not mcp_url:
                    return self._create_error_result(f"No MCP server URL found for {app_slug}")

            # Add query params for proper authentication
            mcp_url = self._add_mcp_query_params(mcp_url, external_user_id)

            # Use x-api-key header (not Authorization: Bearer)
            headers = {
                "x-api-key": api_key,
                "Content-Type": "application/json",
            }

            if connected_account_id:
                headers["x-composio-connected-account-id"] = connected_account_id

            if external_user_id:
                headers["x-composio-entity-id"] = external_user_id

            try:
                async with asyncio.timeout(60):  # 60 second timeout for tool execution
                    async with streamablehttp_client(mcp_url, headers=headers) as (read_stream, write_stream, _):
                        async with ClientSession(read_stream, write_stream) as session:
                            await session.initialize()
                            result = await session.call_tool(original_tool_name, arguments)
                            return self._create_success_result(self._extract_content(result))
            except asyncio.TimeoutError:
                logger.error(f"Composio tool execution timed out after 60 seconds for {original_tool_name}")
                return self._create_error_result(f"Tool execution timed out after 60 seconds")
            except ExceptionGroup as eg:
                logger.error(f"Composio tool execution failed with ExceptionGroup for {original_tool_name}:")
                for i, exc in enumerate(eg.exceptions):
                    logger.error(f"  Sub-exception {i+1}: {type(exc).__name__}: {exc}")
                raise eg.exceptions[0] if eg.exceptions else eg

        except Exception as e:
            error_msg = str(e)
            if hasattr(e, 'exceptions'):
                error_msg = f"{error_msg} (sub-exceptions: {[str(exc) for exc in e.exceptions]})"
            logger.error(f"Error executing Composio MCP tool: {error_msg}")
            return self._create_error_result(f"Error executing Composio tool: {error_msg}")

    def _add_mcp_query_params(self, mcp_url: str, external_user_id: str = None) -> str:
        """Add query parameters to MCP URL for proper Composio authentication."""
        from urllib.parse import urlparse, urlencode, parse_qs, urlunparse

        parsed = urlparse(mcp_url)
        query_params = parse_qs(parsed.query)

        # Add user_id if provided and not already in URL
        if external_user_id and 'user_id' not in query_params:
            query_params['user_id'] = [external_user_id]

        # Add include_composio_helper_actions for better tool discovery
        if 'include_composio_helper_actions' not in query_params:
            query_params['include_composio_helper_actions'] = ['true']

        new_query = urlencode(query_params, doseq=True)
        return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))
    
    async def _execute_sse_tool(self, tool_name: str, arguments: Dict[str, Any], tool_info: Dict[str, Any]) -> ToolResult:
        custom_config = tool_info['custom_config']
        original_tool_name = tool_info['original_name']
        
        url = custom_config['url']
        headers = custom_config.get('headers', {})
        
        async with asyncio.timeout(30):
            try:
                async with sse_client(url, headers=headers) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        result = await session.call_tool(original_tool_name, arguments)
                        return self._create_success_result(self._extract_content(result))
                        
            except TypeError as e:
                if "unexpected keyword argument" in str(e):
                    async with sse_client(url) as (read, write):
                        async with ClientSession(read, write) as session:
                            await session.initialize()
                            result = await session.call_tool(original_tool_name, arguments)
                            return self._create_success_result(self._extract_content(result))
                else:
                    raise
    
    async def _execute_http_tool(self, tool_name: str, arguments: Dict[str, Any], tool_info: Dict[str, Any]) -> ToolResult:
        custom_config = tool_info['custom_config']
        original_tool_name = tool_info['original_name']
        
        url = custom_config['url']
        
        try:
            async with asyncio.timeout(30):
                async with streamablehttp_client(url) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        result = await session.call_tool(original_tool_name, arguments)
                        return self._create_success_result(self._extract_content(result))
                        
        except Exception as e:
            logger.error(f"Error executing HTTP MCP tool: {str(e)}")
            return self._create_error_result(f"Error executing HTTP tool: {str(e)}")
    
    async def _execute_json_tool(self, tool_name: str, arguments: Dict[str, Any], tool_info: Dict[str, Any]) -> ToolResult:
        custom_config = tool_info['custom_config']
        original_tool_name = tool_info['original_name']
        
        server_params = StdioServerParameters(
            command=custom_config["command"],
            args=custom_config.get("args", []),
            env=custom_config.get("env", {})
        )
        
        async with asyncio.timeout(30):
            async with stdio_client(server_params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool(original_tool_name, arguments)
                    return self._create_success_result(self._extract_content(result))
    
    async def _resolve_external_user_id(self, custom_config: Dict[str, Any]) -> str:
        profile_id = custom_config.get('profile_id')
        external_user_id = custom_config.get('external_user_id')
        
        if not profile_id:
            return external_user_id
        
        try:
            from services.supabase import DBConnection
            from utils.encryption import decrypt_data
            
            db = DBConnection()
            supabase = await db.client
            
            result = await supabase.table('user_mcp_credential_profiles').select(
                'encrypted_config'
            ).eq('profile_id', profile_id).single().execute()
            
            if result.data:
                decrypted_config = await asyncio.to_thread(
                    decrypt_data, result.data['encrypted_config']
                )
                config_data = json.loads(decrypted_config)
                return config_data.get('external_user_id', external_user_id)
            
        except Exception as e:
            logger.error(f"Failed to resolve profile {profile_id}: {str(e)}")
        
        return external_user_id
    
    def _extract_content(self, result) -> str:
        if hasattr(result, 'content'):
            content = result.content
            if isinstance(content, list):
                text_parts = []
                for item in content:
                    if hasattr(item, 'text'):
                        text_parts.append(item.text)
                    else:
                        text_parts.append(str(item))
                return "\n".join(text_parts)
            elif hasattr(content, 'text'):
                return content.text
            else:
                return str(content)
        else:
            return str(result)
    
    def _create_success_result(self, content: Any) -> ToolResult:
        if self.tool_wrapper and hasattr(self.tool_wrapper, 'success_response'):
            return self.tool_wrapper.success_response(content)
        return ToolResult(
            success=True,
            content=str(content),
            metadata={}
        )
    
    def _create_error_result(self, error_message: str) -> ToolResult:
        if self.tool_wrapper and hasattr(self.tool_wrapper, 'fail_response'):
            return self.tool_wrapper.fail_response(error_message)
        return ToolResult(
            success=False,
            content=error_message,
            metadata={}
        ) 