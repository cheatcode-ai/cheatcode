"""Composio API client utilities for Cheatcode.

Provides helper functions for Composio REST API access.

Note: We primarily use REST API instead of SDK for better compatibility
with API changes and more predictable behavior.
"""

from typing import Any

import httpx

from utils.config import config
from utils.logger import logger

# Composio API base URLs - v3 is the current version
COMPOSIO_API_V3 = "https://backend.composio.dev/api/v3"


def get_composio_api_key() -> str:
    """Get the Composio API key from centralized config.

    Returns:
        The API key string

    Raises:
        ValueError: If COMPOSIO_API_KEY is not set

    """
    api_key = config.COMPOSIO_API_KEY
    if not api_key:
        raise ValueError(
            "COMPOSIO_API_KEY environment variable is required. Get your API key from https://app.composio.dev"
        )
    return api_key


def get_composio_headers() -> dict[str, str]:
    """Get headers for Composio API requests.

    Returns:
        Dict with required headers

    """
    return {"X-API-Key": get_composio_api_key(), "Content-Type": "application/json"}


async def verify_composio_connection() -> dict:
    """Verify the Composio API connection is working.

    Returns:
        dict with status information

    """
    try:
        api_key = get_composio_api_key()

        # Make a simple API call to verify the key works (using v3 toolkits endpoint)
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{COMPOSIO_API_V3}/toolkits",
                headers={"x-api-key": api_key, "Content-Type": "application/json"},
                params={"limit": 1},  # Just get 1 toolkit to verify
            )

            if response.status_code == 200:
                return {"status": "healthy", "connected": True, "api_key_configured": True}
            if response.status_code == 401:
                return {"status": "error", "connected": False, "error": "Invalid API key", "api_key_configured": True}
            return {
                "status": "error",
                "connected": False,
                "error": f"API returned status {response.status_code}",
                "api_key_configured": True,
            }

    except ValueError as e:
        return {"status": "error", "connected": False, "error": str(e), "api_key_configured": False}
    except httpx.TimeoutException:
        return {"status": "error", "connected": False, "error": "Connection timeout", "api_key_configured": True}
    except Exception as e:
        logger.error(f"Composio connection verification failed: {e}")
        return {"status": "error", "connected": False, "error": str(e), "api_key_configured": True}


# =============================================================================
# MCP Manager - handles MCP server connections via Composio
# =============================================================================

import asyncio
from dataclasses import dataclass

from mcp import ClientSession

try:
    from mcp.client.streamable_http import streamablehttp_client
except ImportError:
    try:
        from mcp.client import streamablehttp_client
    except ImportError as exc:
        raise ImportError(
            "Could not import streamablehttp_client. Make sure you have installed mcp with: pip install 'mcp[cli]'"
        ) from exc

try:
    from mcp.types import CallToolResult as ToolResult
    from mcp.types import Tool
except ImportError:
    try:
        from mcp import types

        Tool = types.Tool
        ToolResult = types.CallToolResult
    except AttributeError:
        Tool = Any
        ToolResult = Any


# Cache for MCP server URLs
_mcp_server_cache: dict[str, str] = {}


def _get_api_key() -> str:
    """Get Composio API key from environment."""
    return get_composio_api_key()


def _get_api_headers() -> dict[str, str]:
    """Get headers for Composio REST API requests."""
    return {"x-api-key": _get_api_key(), "Content-Type": "application/json"}


@dataclass
class MCPConnection:
    """Represents an MCP server connection."""

    qualified_name: str
    name: str
    config: dict[str, Any]
    enabled_tools: list[str]
    mcp_url: str = ""
    mcp_server_id: str = ""
    session: ClientSession | None = None
    tools: list[Tool] | None = None
    external_user_id: str | None = None


async def _get_or_create_mcp_server(
    toolkit_slug: str, connected_account_id: str, external_user_id: str | None = None
) -> tuple[str, str]:
    """Get or create an MCP server for a toolkit.

    Args:
        toolkit_slug: The toolkit name (e.g., 'github')
        connected_account_id: The connected account ID
        external_user_id: Optional external user ID for query params

    Returns:
        Tuple of (mcp_url, server_id)

    """
    cache_key = f"{toolkit_slug}:{connected_account_id}"

    # Check cache first
    if cache_key in _mcp_server_cache:
        cached = _mcp_server_cache[cache_key]
        logger.info(f"Using cached MCP URL for {toolkit_slug}")
        final_url = _add_mcp_query_params(cached, external_user_id)
        return final_url, cache_key

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # First, list existing servers to find one for this toolkit
            response = await client.get(f"{COMPOSIO_API_V3}/mcp/servers", headers=_get_api_headers())

            if response.status_code == 200:
                data = response.json()
                servers = data.get("items", [])

                # Find a server for this toolkit
                for server in servers:
                    if toolkit_slug.lower() in [t.lower() for t in server.get("toolkits", [])]:
                        mcp_url = server.get("mcp_url")
                        server_id = server.get("id")
                        if mcp_url:
                            logger.info(f"Found existing MCP server for {toolkit_slug}: {server_id}")
                            _mcp_server_cache[cache_key] = mcp_url
                            final_url = _add_mcp_query_params(mcp_url, external_user_id)
                            return final_url, server_id

            # No existing server found, need to create one
            auth_config_id = await _get_auth_config_id(toolkit_slug)

            if not auth_config_id:
                raise ValueError(f"No auth config found for toolkit {toolkit_slug}")

            # Create new MCP server
            logger.info(f"Creating new MCP server for {toolkit_slug}")
            response = await client.post(
                f"{COMPOSIO_API_V3}/mcp/servers",
                headers=_get_api_headers(),
                json={
                    "name": f"{toolkit_slug}-mcp-server",
                    "auth_config_ids": [auth_config_id],
                    "connected_account_ids": [connected_account_id],
                },
            )

            if response.status_code in [200, 201]:
                data = response.json()
                mcp_url = data.get("mcp_url")
                server_id = data.get("id")

                if not mcp_url:
                    mcp_url = f"https://backend.composio.dev/v3/mcp/{server_id}"

                logger.info(f"Created MCP server {server_id} with URL: {mcp_url}")
                _mcp_server_cache[cache_key] = mcp_url
                final_url = _add_mcp_query_params(mcp_url, external_user_id)
                return final_url, server_id
            logger.error(f"Failed to create MCP server: {response.status_code} - {response.text}")
            raise ValueError(f"Failed to create MCP server: {response.text}")

    except httpx.TimeoutException:
        logger.error("Timeout creating MCP server")
        raise
    except Exception as e:
        logger.error(f"Error getting/creating MCP server: {e}")
        raise


def _add_mcp_query_params(mcp_url: str, external_user_id: str | None = None) -> str:
    """Add query parameters to MCP URL for proper authentication."""
    from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

    parsed = urlparse(mcp_url)
    query_params = parse_qs(parsed.query)

    if external_user_id and "user_id" not in query_params:
        query_params["user_id"] = [external_user_id]

    if "include_composio_helper_actions" not in query_params:
        query_params["include_composio_helper_actions"] = ["true"]

    new_query = urlencode(query_params, doseq=True)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))


async def _get_auth_config_id(toolkit_slug: str) -> str | None:
    """Get the auth config ID for a toolkit."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{COMPOSIO_API_V3}/auth_configs",
                headers=_get_api_headers(),
                params={"toolkit_slug": toolkit_slug.lower(), "is_composio_managed": "true", "limit": 1},
            )

            if response.status_code == 200:
                data = response.json()
                items = data.get("items", [])
                if items:
                    return items[0].get("id")

            # Try to create one if not found
            response = await client.post(
                f"{COMPOSIO_API_V3}/auth_configs",
                headers=_get_api_headers(),
                json={"toolkit": {"slug": toolkit_slug.lower()}},
            )

            if response.status_code in [200, 201]:
                data = response.json()
                auth_config = data.get("auth_config", data)
                return auth_config.get("id")

    except Exception as e:
        logger.error(f"Error getting auth config for {toolkit_slug}: {e}")

    return None


def get_mcp_composio_headers(config: dict[str, Any], external_user_id: str | None = None) -> dict[str, str]:
    """Get headers for Composio MCP server connection.

    Args:
        config: Configuration dict with optional api_key and connected_account_id
        external_user_id: Optional external user ID for entity tracking

    Returns:
        Headers dict for the MCP connection

    """
    api_key = config.get("api_key") or get_composio_api_key()

    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json",
    }

    connected_account_id = config.get("connected_account_id")
    if connected_account_id:
        headers["x-composio-connected-account-id"] = connected_account_id

    if external_user_id:
        headers["x-composio-entity-id"] = external_user_id

    return headers


class MCPManager:
    """Manages MCP server connections via Composio."""

    def __init__(self):
        self.connections: dict[str, MCPConnection] = {}
        self._sessions: dict[str, tuple[Any, Any, Any]] = {}

    async def connect_server(self, mcp_config: dict[str, Any], external_user_id: str | None = None) -> MCPConnection:
        """Connect to an MCP server via Composio."""
        qualified_name = mcp_config["qualifiedName"]

        connection_key = f"composio:{qualified_name}"
        if external_user_id:
            connection_key = f"composio:{qualified_name}:{external_user_id}"

        if connection_key in self.connections:
            logger.info(f"MCP server {qualified_name} already connected")
            return self.connections[connection_key]

        logger.info(f"Connecting to MCP server: {qualified_name} via Composio")

        try:
            config = mcp_config.get("config", {})
            connected_account_id = config.get("connected_account_id")

            if not connected_account_id:
                raise ValueError(f"No connected_account_id provided for {qualified_name}")

            config_external_user_id = config.get("external_user_id") or external_user_id

            mcp_url, server_id = await _get_or_create_mcp_server(
                qualified_name, connected_account_id, external_user_id=config_external_user_id
            )

            logger.info(f"Using MCP URL: {mcp_url}")

            headers = get_mcp_composio_headers(config, external_user_id)
            logger.debug(f"MCP connection headers (keys only): {list(headers.keys())}")

            try:
                async with asyncio.timeout(45):
                    async with streamablehttp_client(mcp_url, headers=headers) as (read_stream, write_stream, _):
                        async with ClientSession(read_stream, write_stream) as session:
                            await session.initialize()
                            logger.info(f"MCP session initialized for {qualified_name}")

                            tools_result = await session.list_tools()
                            tools = tools_result.tools if hasattr(tools_result, "tools") else tools_result
            except TimeoutError as te:
                logger.error(f"MCP connection timed out for {qualified_name} after 45 seconds")
                raise TimeoutError(f"MCP connection to {qualified_name} timed out") from te
            except ExceptionGroup as eg:
                logger.error(f"MCP connection failed with ExceptionGroup for {qualified_name}:")
                for i, exc in enumerate(eg.exceptions):
                    logger.error(f"  Sub-exception {i + 1}: {type(exc).__name__}: {exc}")
                raise (eg.exceptions[0] if eg.exceptions else eg) from eg
            except BaseExceptionGroup as beg:
                logger.error(f"MCP connection failed with BaseExceptionGroup for {qualified_name}:")
                for i, exc in enumerate(beg.exceptions):
                    logger.error(f"  Sub-exception {i + 1}: {type(exc).__name__}: {exc}")
                raise (beg.exceptions[0] if beg.exceptions else beg) from beg

            logger.info(f"Available tools from {qualified_name}: {[t.name for t in tools]}")

            connection = MCPConnection(
                qualified_name=qualified_name,
                name=mcp_config["name"],
                config=config,
                enabled_tools=mcp_config.get("enabledTools", []),
                mcp_url=mcp_url,
                mcp_server_id=server_id,
                session=None,
                tools=tools,
                external_user_id=external_user_id,
            )

            self.connections[connection_key] = connection
            return connection

        except Exception as e:
            if hasattr(e, "exceptions"):
                logger.error(f"Failed to connect to MCP server {qualified_name} with sub-exceptions:")
                for i, exc in enumerate(e.exceptions):
                    logger.error(f"  Sub-exception {i + 1}: {type(exc).__name__}: {exc}")
            else:
                logger.error(f"Failed to connect to MCP server {qualified_name}: {type(e).__name__}: {e!s}")
            raise

    async def connect_all(self, mcp_configs: list[dict[str, Any]]) -> None:
        """Connect to all configured MCP servers."""
        for mcp_cfg in mcp_configs:
            try:
                await self.connect_server(mcp_cfg)
            except Exception as e:
                logger.error(f"Failed to connect to {mcp_cfg['qualifiedName']}: {e!s}")

    def get_all_tools_openapi(self) -> list[dict[str, Any]]:
        """Get all tools from connected MCP servers in OpenAPI format."""
        openapi_tools = []

        for conn in self.connections.values():
            if not conn.tools:
                continue

            for tool in conn.tools:
                if conn.enabled_tools and tool.name not in conn.enabled_tools:
                    continue

                tool_name = f"mcp_{conn.qualified_name}_{tool.name}"

                openapi_tool = {
                    "name": tool_name,
                    "description": f"{tool.description} (from {conn.name} MCP server)",
                    "parameters": tool.inputSchema
                    if hasattr(tool, "inputSchema")
                    else {"type": "object", "properties": {}, "required": []},
                }

                openapi_tools.append(openapi_tool)

        logger.info(f"Converted {len(openapi_tools)} MCP tools to OpenAPI format")
        return openapi_tools

    async def execute_tool(
        self, tool_name: str, arguments: dict[str, Any], external_user_id: str | None = None
    ) -> dict[str, Any]:
        """Execute a tool on an MCP server."""
        parts = tool_name.split("_", 2)
        if len(parts) != 3 or parts[0] != "mcp":
            raise ValueError(f"Invalid MCP tool name format: {tool_name}")

        _, qualified_name, original_tool_name = parts

        conn = None
        for connection in self.connections.values():
            if connection.qualified_name != qualified_name:
                continue

            if external_user_id is None or connection.external_user_id == external_user_id:
                conn = connection
                break

        if not conn:
            raise ValueError(f"MCP server {qualified_name} not connected")

        logger.info(f"Executing MCP tool {original_tool_name} on server {qualified_name}")

        try:
            url = conn.mcp_url
            if not url:
                raise ValueError(f"No MCP URL stored for {qualified_name}")

            effective_user_id = external_user_id or conn.external_user_id
            url = _add_mcp_query_params(url, effective_user_id)
            headers = get_mcp_composio_headers(conn.config, effective_user_id)

            async with asyncio.timeout(60):
                async with streamablehttp_client(url, headers=headers) as (read_stream, write_stream, _):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        result = await session.call_tool(original_tool_name, arguments)

                    if hasattr(result, "content"):
                        content = result.content
                        if isinstance(content, list):
                            text_parts = []
                            for item in content:
                                if hasattr(item, "text"):
                                    text_parts.append(item.text)
                                elif hasattr(item, "content"):
                                    text_parts.append(str(item.content))
                                else:
                                    text_parts.append(str(item))
                            content_str = "\n".join(text_parts)
                        elif hasattr(content, "text"):
                            content_str = content.text
                        elif hasattr(content, "content"):
                            content_str = str(content.content)
                        else:
                            content_str = str(content)

                        is_error = getattr(result, "isError", False)
                    else:
                        content_str = str(result)
                        is_error = False

            return {"content": content_str, "isError": is_error}

        except Exception as e:
            logger.error(f"Error executing MCP tool {tool_name}: {e!s}")
            return {"content": f"Error executing tool: {e!s}", "isError": True}

    async def disconnect_all(self):
        """Disconnect from all MCP servers."""
        for qualified_name in list(self.connections.keys()):
            try:
                del self.connections[qualified_name]
                logger.info(f"Cleared MCP server configuration for {qualified_name}")
            except Exception as e:
                logger.error(f"Error clearing configuration for {qualified_name}: {e!s}")

        self._sessions.clear()

    def get_tool_info(self, tool_name: str) -> dict[str, Any] | None:
        """Get information about a specific MCP tool."""
        parts = tool_name.split("_", 2)
        if len(parts) != 3 or parts[0] != "mcp":
            return None

        _, qualified_name, original_tool_name = parts

        conn = None
        for connection in self.connections.values():
            if connection.qualified_name == qualified_name:
                conn = connection
                break

        if not conn or not conn.tools:
            return None

        for tool in conn.tools:
            if tool.name == original_tool_name:
                return {
                    "server": conn.name,
                    "qualified_name": qualified_name,
                    "original_name": tool.name,
                    "description": tool.description,
                    "enabled": not conn.enabled_tools or tool.name in conn.enabled_tools,
                }

        return None
