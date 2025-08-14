import asyncio
import json
import base64
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass

from mcp import ClientSession
try:
    from mcp.client.streamable_http import streamablehttp_client
except ImportError:
    try:
        from mcp.client import streamablehttp_client
    except ImportError:
        raise ImportError(
            "Could not import streamablehttp_client. "
            "Make sure you have installed mcp with: pip install 'mcp[cli]'"
        )

try:
    from mcp.types import Tool, CallToolResult as ToolResult
except ImportError:
    try:
        from mcp import types
        Tool = types.Tool
        ToolResult = types.CallToolResult
    except AttributeError:
        Tool = Any
        ToolResult = Any

from utils.logger import logger
from .mcp_providers import MCPProviderFactory, SmitheryProvider, PipedreamProvider
import os

SMITHERY_API_KEY = os.getenv("SMITHERY_API_KEY")
SMITHERY_SERVER_BASE_URL = "https://server.smithery.ai"

@dataclass
class MCPConnection:
    qualified_name: str
    name: str
    config: Dict[str, Any]
    enabled_tools: List[str]
    session: Optional[ClientSession] = None
    tools: Optional[List[Tool]] = None
    provider: Optional[str] = 'smithery'
    external_user_id: Optional[str] = None
    
class MCPManager:
    def __init__(self):
        self.connections: Dict[str, MCPConnection] = {}
        self._sessions: Dict[str, Tuple[Any, Any, Any]] = {}  # Store streams for cleanup
        
    async def connect_server(self, mcp_config: Dict[str, Any], external_user_id: Optional[str] = None) -> MCPConnection:
        qualified_name = mcp_config["qualifiedName"]
        provider_type = mcp_config.get("provider", "smithery")
        
        connection_key = f"{provider_type}:{qualified_name}"
        if external_user_id and provider_type == "pipedream":
            connection_key = f"{provider_type}:{qualified_name}:{external_user_id}"
            
        if connection_key in self.connections:
            logger.info(f"MCP server {qualified_name} ({provider_type}) already connected")
            return self.connections[connection_key]
            
        logger.info(f"Connecting to MCP server: {qualified_name} via {provider_type}")
        
        try:
            provider = MCPProviderFactory.create_provider(provider_type)
            url = provider.get_server_url(qualified_name, mcp_config.get("config", {}))
            
            if provider_type == "pipedream":
                if not external_user_id:
                    raise ValueError("external_user_id is required for Pipedream MCP connections")
                headers = await provider.get_headers_async(qualified_name, mcp_config.get("config", {}), external_user_id)
            else:
                headers = provider.get_headers(qualified_name, mcp_config.get("config", {}), external_user_id)
            
            async with streamablehttp_client(url, headers=headers) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    logger.info(f"MCP session initialized for {qualified_name} via {provider_type}")
                    
                    tools_result = await session.list_tools()
                    tools = tools_result.tools if hasattr(tools_result, 'tools') else tools_result
            
            logger.info(f"Available tools from {qualified_name}: {[t.name for t in tools]}")
            
            connection = MCPConnection(
                qualified_name=qualified_name,
                name=mcp_config["name"],
                config=mcp_config.get("config", {}),
                enabled_tools=mcp_config.get("enabledTools", []),
                session=None,
                tools=tools,
                provider=provider_type,
                external_user_id=external_user_id
            )
            
            self.connections[connection_key] = connection
            return connection
            
        except Exception as e:
            logger.error(f"Failed to connect to MCP server {qualified_name} via {provider_type}: {str(e)}")
            raise
        
    async def connect_all(self, mcp_configs: List[Dict[str, Any]]) -> None:
        for config in mcp_configs:
            try:
                await self.connect_server(config)
            except Exception as e:
                logger.error(f"Failed to connect to {config['qualifiedName']}: {str(e)}")
                
    def get_all_tools_openapi(self) -> List[Dict[str, Any]]:
        openapi_tools = []
        
        for connection_key, conn in self.connections.items():
            if not conn.tools:
                continue
                
            for tool in conn.tools:
                if conn.enabled_tools and tool.name not in conn.enabled_tools:
                    continue
                    
                tool_name = f"mcp_{conn.qualified_name}_{tool.name}"
                
                openapi_tool = {
                    "name": tool_name,
                    "description": f"{tool.description} (from {conn.name} MCP server)",
                    "parameters": tool.inputSchema if hasattr(tool, 'inputSchema') else {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                }
                
                openapi_tools.append(openapi_tool)
                
        logger.info(f"Converted {len(openapi_tools)} MCP tools to OpenAPI format")
        return openapi_tools
        
    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any], external_user_id: Optional[str] = None) -> Dict[str, Any]:
        parts = tool_name.split("_", 2)
        if len(parts) != 3 or parts[0] != "mcp":
            raise ValueError(f"Invalid MCP tool name format: {tool_name}")
            
        _, qualified_name, original_tool_name = parts
        
        conn = None
        for connection_key, connection in self.connections.items():
            if connection.qualified_name != qualified_name:
                continue

            # For Pipedream connections we prefer an exact external_user_id match
            # but if none was provided we fall back to the first connection we find.
            if connection.provider == "pipedream":
                if external_user_id is None or connection.external_user_id == external_user_id:
                    conn = connection
                    break
            else:
                conn = connection
                break
        
        if not conn:
            raise ValueError(f"MCP server {qualified_name} not connected")
            
        logger.info(f"Executing MCP tool {original_tool_name} on server {qualified_name} via {conn.provider}")
        
        try:
            provider = MCPProviderFactory.create_provider(conn.provider)
            
            url = provider.get_server_url(qualified_name, conn.config)
            
            if conn.provider == "pipedream":
                # If caller didn't supply external_user_id, use the one associated with the connection.
                if external_user_id is None:
                    external_user_id = conn.external_user_id

                if not external_user_id:
                    raise ValueError("external_user_id is required for Pipedream MCP tool execution")
                headers = await provider.get_headers_async(qualified_name, conn.config, external_user_id)
            else:
                headers = provider.get_headers(qualified_name, conn.config, external_user_id)
            
            async with streamablehttp_client(url, headers=headers) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool(original_tool_name, arguments)
                    if hasattr(result, 'content'):
                        content = result.content
                        if isinstance(content, list):
                            text_parts = []
                            for item in content:
                                if hasattr(item, 'text'):
                                    text_parts.append(item.text)
                                elif hasattr(item, 'content'):
                                    text_parts.append(str(item.content))
                                else:
                                    text_parts.append(str(item))
                            content_str = "\n".join(text_parts)
                        elif hasattr(content, 'text'):
                            content_str = content.text
                        elif hasattr(content, 'content'):
                            content_str = str(content.content)
                        else:
                            content_str = str(content)
                        
                        is_error = getattr(result, 'isError', False)
                    else:
                        content_str = str(result)
                        is_error = False
                        
                return {
                        "content": content_str,
                        "isError": is_error
                }
                
        except Exception as e:
            logger.error(f"Error executing MCP tool {tool_name}: {str(e)}")
            return {
                "content": f"Error executing tool: {str(e)}",
                "isError": True
            }
            
    async def disconnect_all(self):
        for qualified_name in list(self.connections.keys()):
            try:
                del self.connections[qualified_name]
                logger.info(f"Cleared MCP server configuration for {qualified_name}")
            except Exception as e:
                logger.error(f"Error clearing configuration for {qualified_name}: {str(e)}")
                
        self._sessions.clear()
                
    def get_tool_info(self, tool_name: str) -> Optional[Dict[str, Any]]:
        parts = tool_name.split("_", 2)
        if len(parts) != 3 or parts[0] != "mcp":
            return None
            
        _, qualified_name, original_tool_name = parts
        
        if qualified_name not in self.connections:
            return None
            
        conn = self.connections[qualified_name]
        if not conn.tools:
            return None
            
        for tool in conn.tools:
            if tool.name == original_tool_name:
                return {
                    "server": conn.name,
                    "qualified_name": qualified_name,
                    "original_name": tool.name,
                    "description": tool.description,
                    "enabled": not conn.enabled_tools or tool.name in conn.enabled_tools
                }
                
        return None 