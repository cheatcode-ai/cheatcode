"""
MCP Server Service for Composio.
Handles MCP URL generation and tool discovery via MCP protocol.
Uses REST API for compatibility with SDK changes.

Composio MCP URL format: https://backend.composio.dev/v3/mcp/{server_id}
Authentication via headers: x-api-key, x-composio-connected-account-id
"""

import os
import httpx
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from utils.logger import logger


# Composio API base URL - v3 is the current version
COMPOSIO_API_V3 = "https://backend.composio.dev/api/v3"


def _get_api_key() -> str:
    """Get Composio API key from environment."""
    api_key = os.getenv("COMPOSIO_API_KEY")
    if not api_key:
        raise ValueError("COMPOSIO_API_KEY environment variable is required")
    return api_key


def _get_headers() -> Dict[str, str]:
    """Get headers for Composio API requests."""
    return {
        "X-API-Key": _get_api_key(),
        "Content-Type": "application/json"
    }


class MCPTool(BaseModel):
    """Represents a tool discovered from MCP server."""
    name: str
    description: Optional[str] = None
    input_schema: Dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class MCPConfig(BaseModel):
    """MCP configuration for a connected account."""
    mcp_url: str
    app_name: str
    connected_account_id: str
    enabled_tools: List[str] = Field(default_factory=list)
    available_tools: List[MCPTool] = Field(default_factory=list)


class MCPServerService:
    """Service for MCP server management and tool discovery."""

    async def generate_mcp_url(
        self,
        connected_account_id: str,
        user_id: Optional[str] = None,
        tools: Optional[List[str]] = None
    ) -> str:
        """
        Generate an MCP URL for a connected account.

        MCP URLs are obtained from the Composio API by listing or creating MCP servers.
        The correct URL format is: https://backend.composio.dev/v3/mcp/{server_id}

        Args:
            connected_account_id: The Composio connected account ID
            user_id: Optional user ID for context
            tools: Optional list of specific tools to enable

        Returns:
            MCP server URL for the connected account

        Raises:
            Exception: If URL generation fails
        """
        try:
            mcp_url = None
            app_name = None

            async with httpx.AsyncClient(timeout=30.0) as client:
                # Step 1: Get app name from connected account
                try:
                    response = await client.get(
                        f"{COMPOSIO_API_V3}/connected_accounts/{connected_account_id}",
                        headers=_get_headers()
                    )
                    if response.status_code == 200:
                        data = response.json()
                        app_name = (
                            data.get('appName') or
                            data.get('app_name') or
                            data.get('app')
                        )
                except Exception as lookup_error:
                    logger.warning(f"Could not lookup app for connected account: {lookup_error}")

                # Step 2: Find existing MCP server for this toolkit
                if app_name:
                    try:
                        response = await client.get(
                            f"{COMPOSIO_API_V3}/mcp/servers",
                            headers=_get_headers()
                        )
                        if response.status_code == 200:
                            data = response.json()
                            servers = data.get('items', [])

                            for server in servers:
                                if app_name.lower() in [t.lower() for t in server.get('toolkits', [])]:
                                    mcp_url = server.get('mcp_url')
                                    if mcp_url:
                                        logger.info(f"Found existing MCP server for {app_name}")
                                        break
                    except Exception as e:
                        logger.debug(f"Error listing MCP servers: {e}")

                # Step 3: Create MCP server if not found
                if not mcp_url and app_name:
                    try:
                        # Get auth config ID for the app
                        auth_response = await client.get(
                            f"{COMPOSIO_API_V3}/auth_configs",
                            headers=_get_headers(),
                            params={
                                "toolkit_slug": app_name.lower(),
                                "is_composio_managed": "true",
                                "limit": 1
                            }
                        )

                        auth_config_id = None
                        if auth_response.status_code == 200:
                            auth_data = auth_response.json()
                            items = auth_data.get('items', [])
                            if items:
                                auth_config_id = items[0].get('id')

                        if auth_config_id:
                            # Create new MCP server
                            logger.info(f"Creating new MCP server for {app_name}")
                            create_response = await client.post(
                                f"{COMPOSIO_API_V3}/mcp/servers",
                                headers=_get_headers(),
                                json={
                                    "name": f"{app_name.lower()}-mcp-server",
                                    "auth_config_ids": [auth_config_id],
                                    "connected_account_ids": [connected_account_id]
                                }
                            )

                            if create_response.status_code in [200, 201]:
                                create_data = create_response.json()
                                mcp_url = create_data.get('mcp_url')
                                server_id = create_data.get('id')

                                if not mcp_url and server_id:
                                    mcp_url = f"https://backend.composio.dev/v3/mcp/{server_id}"

                                logger.info(f"Created MCP server with URL: {mcp_url}")
                    except Exception as create_error:
                        logger.warning(f"Error creating MCP server: {create_error}")

            if not mcp_url:
                raise ValueError(f"Could not generate MCP URL for connected account {connected_account_id}")

            logger.info(f"Generated MCP URL for account {connected_account_id}")
            return mcp_url

        except Exception as e:
            logger.error(f"Failed to generate MCP URL for {connected_account_id}: {e}")
            raise

    async def get_mcp_config_for_profile(
        self,
        profile_id: str,
        connected_account_id: str,
        app_name: str,
        enabled_tools: List[str] = []
    ) -> MCPConfig:
        """
        Get complete MCP configuration for a profile.

        Args:
            profile_id: The profile ID
            connected_account_id: The Composio connected account ID
            app_name: The app name
            enabled_tools: List of enabled tool names

        Returns:
            MCPConfig with URL and tool information
        """
        mcp_url = await self.generate_mcp_url(connected_account_id)

        # Try to get available tools
        available_tools = []
        try:
            tools = await self.discover_tools_via_api(connected_account_id, app_name)
            available_tools = tools
        except Exception as e:
            logger.warning(f"Could not discover tools for config: {e}")

        return MCPConfig(
            mcp_url=mcp_url,
            app_name=app_name,
            connected_account_id=connected_account_id,
            enabled_tools=enabled_tools,
            available_tools=available_tools
        )

    async def discover_tools(
        self,
        mcp_url: str,
        connected_account_id: Optional[str] = None
    ) -> List[MCPTool]:
        """
        Discover available tools from an MCP server URL.

        Uses MCP protocol over streamable HTTP with Composio authentication headers.

        Args:
            mcp_url: The MCP server URL
            connected_account_id: Optional connected account ID for authentication

        Returns:
            List of discovered tools
        """
        try:
            # Try MCP protocol discovery
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client

            # Build headers for Composio authentication
            # Per Composio docs: use x-api-key header and x-composio-connected-account-id
            headers = {}
            try:
                api_key = _get_api_key()
                headers["x-api-key"] = api_key
            except ValueError:
                pass
            if connected_account_id:
                headers["x-composio-connected-account-id"] = connected_account_id

            logger.debug(f"Discovering tools from MCP URL: {mcp_url}")

            async with streamablehttp_client(mcp_url, headers=headers) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools_result = await session.list_tools()

                    tools = []
                    for tool in tools_result.tools:
                        tools.append(MCPTool(
                            name=tool.name,
                            description=getattr(tool, 'description', None),
                            input_schema=getattr(tool, 'inputSchema', {}) or {}
                        ))

                    logger.info(f"Discovered {len(tools)} tools from MCP server")
                    return tools

        except ImportError:
            logger.warning("MCP client not available, using API fallback")
            # Try REST API fallback
            if connected_account_id:
                return await self.discover_tools_via_api(connected_account_id)
            return []
        except Exception as e:
            logger.error(f"Failed to discover tools from MCP URL: {e}")
            return []

    async def discover_tools_via_api(
        self,
        connected_account_id: str,
        app_name: Optional[str] = None
    ) -> List[MCPTool]:
        """
        Discover tools using Composio REST API directly.

        Args:
            connected_account_id: The connected account ID
            app_name: Optional app name filter

        Returns:
            List of discovered tools
        """
        try:
            # Get actions/tools from Composio REST API
            params: Dict[str, Any] = {}
            if app_name:
                params["appNames"] = app_name.upper()

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{COMPOSIO_API_V3}/actions",
                    headers=_get_headers(),
                    params=params
                )
                response.raise_for_status()
                data = response.json()

            # Handle different response formats
            actions_data = []
            if isinstance(data, list):
                actions_data = data
            elif isinstance(data, dict):
                actions_data = data.get('items') or data.get('actions') or data.get('data') or []

            tools = []
            for action in actions_data:
                name = action.get('name') or action.get('key') or ''
                description = action.get('description', '')
                parameters = (
                    action.get('parameters') or
                    action.get('inputSchema') or
                    action.get('input_schema') or
                    {}
                )

                tools.append(MCPTool(
                    name=name,
                    description=description,
                    input_schema=parameters if isinstance(parameters, dict) else {}
                ))

            logger.info(f"Discovered {len(tools)} tools via API for {connected_account_id or app_name}")
            return tools

        except Exception as e:
            logger.error(f"Failed to discover tools via API: {e}")
            return []

    async def list_tools_for_app(
        self,
        app_name: str,
        limit: int = 100
    ) -> List[MCPTool]:
        """
        List all available tools for an app (before connection).

        Args:
            app_name: The app/toolkit name
            limit: Max tools to return

        Returns:
            List of tools
        """
        try:
            # Get actions for this app via REST API
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{COMPOSIO_API_V3}/actions",
                    headers=_get_headers(),
                    params={"appNames": app_name.upper(), "limit": limit}
                )
                response.raise_for_status()
                data = response.json()

            # Handle different response formats
            actions_data = []
            if isinstance(data, list):
                actions_data = data[:limit]
            elif isinstance(data, dict):
                actions_data = (data.get('items') or data.get('actions') or data.get('data') or [])[:limit]

            tools = []
            for action in actions_data:
                name = action.get('name') or action.get('key') or ''
                description = action.get('description', '')
                parameters = (
                    action.get('parameters') or
                    action.get('inputSchema') or
                    {}
                )

                tools.append(MCPTool(
                    name=name,
                    description=description,
                    input_schema=parameters if isinstance(parameters, dict) else {}
                ))

            return tools

        except Exception as e:
            logger.error(f"Failed to list tools for app {app_name}: {e}")
            return []

    async def test_mcp_connection(
        self,
        mcp_url: str,
        connected_account_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Test connectivity to an MCP server.

        Args:
            mcp_url: The MCP server URL
            connected_account_id: Optional connected account ID for authentication

        Returns:
            Dict with connection status and details
        """
        try:
            tools = await self.discover_tools(mcp_url, connected_account_id)

            return {
                "status": "connected",
                "tool_count": len(tools),
                "tools": [t.name for t in tools[:10]],  # First 10 tool names
                "mcp_url": mcp_url
            }

        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "mcp_url": mcp_url
            }

    async def execute_tool(
        self,
        connected_account_id: str,
        tool_name: str,
        parameters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Execute a tool via the connected account.

        Args:
            connected_account_id: The connected account ID
            tool_name: The tool/action name
            parameters: Tool parameters

        Returns:
            Tool execution result
        """
        try:
            # Execute action via REST API
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{COMPOSIO_API_V3}/actions/{tool_name}/execute",
                    headers=_get_headers(),
                    json={
                        "connectedAccountId": connected_account_id,
                        "input": parameters
                    }
                )
                response.raise_for_status()
                result = response.json()

            return {
                "success": True,
                "result": result
            }

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error executing tool {tool_name}: {e.response.status_code}")
            return {
                "success": False,
                "error": f"HTTP {e.response.status_code}: {e.response.text}"
            }
        except Exception as e:
            logger.error(f"Failed to execute tool {tool_name}: {e}")
            return {
                "success": False,
                "error": str(e)
            }
