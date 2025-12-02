import json
import asyncio
from typing import Dict, Any, List
from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client
from utils.logger import logger
from .mcp_connection_manager import MCPConnectionManager


class CustomMCPHandler:
    def __init__(self, connection_manager: MCPConnectionManager):
        self.connection_manager = connection_manager
        self.custom_tools: Dict[str, Dict[str, Any]] = {}
    
    async def initialize_custom_mcps(self, custom_configs: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        for config in custom_configs:
            try:
                await self._initialize_single_custom_mcp(config)
            except Exception as e:
                logger.error(f"Failed to initialize custom MCP {config.get('name', 'Unknown')}: {e}")
                continue
        
        return self.custom_tools
    
    async def _initialize_single_custom_mcp(self, config: Dict[str, Any]):
        custom_type = config.get('customType', 'sse')
        server_config = config.get('config', {})
        enabled_tools = config.get('enabledTools', [])
        server_name = config.get('name', 'Unknown')
        
        logger.info(f"Initializing custom MCP: {server_name} (type: {custom_type})")
        
        if custom_type == 'composio':
            await self._initialize_composio_mcp(server_name, server_config, enabled_tools)
        elif custom_type == 'sse':
            await self._initialize_sse_mcp(server_name, server_config, enabled_tools)
        elif custom_type == 'http':
            await self._initialize_http_mcp(server_name, server_config, enabled_tools)
        elif custom_type == 'json':
            await self._initialize_json_mcp(server_name, server_config, enabled_tools)
        else:
            logger.error(f"Custom MCP {server_name}: Unsupported type '{custom_type}'")
    
    async def _initialize_composio_mcp(self, server_name: str, server_config: Dict[str, Any], enabled_tools: List[str]):
        """Initialize a Composio MCP server connection using Composio REST API."""
        import os
        import httpx

        app_slug = server_config.get('app_slug') or server_config.get('qualified_name')
        if not app_slug:
            logger.error(f"Custom MCP {server_name}: Missing app_slug for Composio")
            return

        # Get API key from config or environment
        api_key = server_config.get('api_key') or os.getenv('COMPOSIO_API_KEY')
        if not api_key:
            logger.error(f"Custom MCP {server_name}: Missing API key for Composio")
            return

        # Get connected account ID if available
        connected_account_id = server_config.get('connected_account_id')
        external_user_id = await self._resolve_external_user_id(server_config)

        logger.info(f"Initializing Composio MCP for {app_slug} (connected_account: {connected_account_id})")

        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client

            # Use Composio REST API to get/create MCP server
            COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3"
            api_headers = {
                "x-api-key": api_key,
                "Content-Type": "application/json"
            }

            mcp_url = None

            # Step 1: Try to find existing MCP server for this toolkit
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
                                logger.info(f"Found existing MCP server for {app_slug}: {server.get('id')}")
                                break

                # Step 2: Create MCP server if not found
                if not mcp_url and connected_account_id:
                    # Get auth config for the toolkit
                    auth_config_response = await client.get(
                        f"{COMPOSIO_API_BASE}/auth_configs",
                        headers=api_headers,
                        params={
                            "toolkit_slug": app_slug.lower(),
                            "is_composio_managed": "true",
                            "limit": 1
                        }
                    )

                    auth_config_id = None
                    if auth_config_response.status_code == 200:
                        auth_data = auth_config_response.json()
                        items = auth_data.get('items', [])
                        if items:
                            auth_config_id = items[0].get('id')

                    if auth_config_id:
                        # Create new MCP server
                        logger.info(f"Creating new MCP server for {app_slug}")
                        create_response = await client.post(
                            f"{COMPOSIO_API_BASE}/mcp/servers",
                            headers=api_headers,
                            json={
                                "name": f"{app_slug}-mcp-server",
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

                            logger.info(f"Created MCP server {server_id} with URL: {mcp_url}")

            if not mcp_url:
                logger.error(f"Custom MCP {server_name}: Could not get MCP URL for {app_slug}")
                return

            # Add query params for proper authentication
            mcp_url = self._add_mcp_query_params(mcp_url, external_user_id)

            # Store the MCP URL in server_config for later use during execution
            server_config['mcp_url'] = mcp_url

            # Headers for MCP connection (x-api-key, not Authorization Bearer)
            headers = {
                "x-api-key": api_key,
                "Content-Type": "application/json",
            }

            if connected_account_id:
                headers["x-composio-connected-account-id"] = connected_account_id

            if external_user_id:
                headers["x-composio-entity-id"] = external_user_id

            try:
                async with asyncio.timeout(45):  # 45 second timeout
                    async with streamablehttp_client(mcp_url, headers=headers) as (read_stream, write_stream, _):
                        async with ClientSession(read_stream, write_stream) as session:
                            await session.initialize()
                            tools_result = await session.list_tools()
                            tools = tools_result.tools if hasattr(tools_result, 'tools') else tools_result

                            self._register_custom_tools(tools, server_name, enabled_tools, 'composio', server_config)
            except asyncio.TimeoutError:
                logger.error(f"Composio MCP {server_name}: Connection timed out after 45 seconds")
                raise TimeoutError(f"Composio MCP connection to {app_slug} timed out")
            except ExceptionGroup as eg:
                logger.error(f"Composio MCP {server_name}: Connection failed with ExceptionGroup:")
                for i, exc in enumerate(eg.exceptions):
                    logger.error(f"  Sub-exception {i+1}: {type(exc).__name__}: {exc}")
                raise eg.exceptions[0] if eg.exceptions else eg

        except Exception as e:
            error_msg = str(e)
            if hasattr(e, 'exceptions'):
                error_msg = f"{error_msg} (sub-exceptions: {[str(exc) for exc in e.exceptions]})"
            logger.error(f"Composio MCP {server_name}: Connection failed - {error_msg}")
            raise
    
    async def _initialize_sse_mcp(self, server_name: str, server_config: Dict[str, Any], enabled_tools: List[str]):
        if 'url' not in server_config:
            logger.error(f"Custom MCP {server_name}: Missing 'url' in config")
            return
        
        server_info = await self.connection_manager.connect_sse_server(server_name, server_config)
        if server_info.get('status') == 'connected':
            tools_info = server_info.get('tools', [])
            self._register_custom_tools_from_info(tools_info, server_name, enabled_tools, 'sse', server_config)
        else:
            logger.error(f"Failed to connect to custom MCP {server_name}")
    
    async def _initialize_http_mcp(self, server_name: str, server_config: Dict[str, Any], enabled_tools: List[str]):
        if 'url' not in server_config:
            logger.error(f"Custom MCP {server_name}: Missing 'url' in config")
            return
        
        server_info = await self.connection_manager.connect_http_server(server_name, server_config)
        if server_info.get('status') == 'connected':
            tools_info = server_info.get('tools', [])
            self._register_custom_tools_from_info(tools_info, server_name, enabled_tools, 'http', server_config)
        else:
            logger.error(f"Failed to connect to custom MCP {server_name}")

    async def _initialize_json_mcp(self, server_name: str, server_config: Dict[str, Any], enabled_tools: List[str]):
        if 'command' not in server_config:
            logger.error(f"Custom MCP {server_name}: Missing 'command' in config")
            return

        server_info = await self.connection_manager.connect_stdio_server(server_name, server_config)
        if server_info.get('status') == 'connected':
            tools_info = server_info.get('tools', [])
            self._register_custom_tools_from_info(tools_info, server_name, enabled_tools, 'json', server_config)
        else:
            logger.error(f"Failed to connect to custom MCP {server_name}")

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

    async def _resolve_external_user_id(self, server_config: Dict[str, Any]) -> str:
        profile_id = server_config.get('profile_id')
        external_user_id = server_config.get('external_user_id')
        
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
                profile_external_user_id = config_data.get('external_user_id')
                
                if external_user_id and external_user_id != profile_external_user_id:
                    logger.warning(f"Overriding external_user_id {external_user_id} with profile's external_user_id {profile_external_user_id}")
                
                if 'oauth_app_id' in config_data:
                    server_config['oauth_app_id'] = config_data['oauth_app_id']
                
                return profile_external_user_id
            else:
                logger.error(f"Profile {profile_id} not found")
                return None
                
        except Exception as e:
            logger.error(f"Failed to resolve profile {profile_id}: {str(e)}")
            return None
    
    def _register_custom_tools(self, tools, server_name: str, enabled_tools: List[str], custom_type: str, server_config: Dict[str, Any]):
        tools_registered = 0
        
        for tool in tools:
            tool_name_from_server = tool.name
            if not enabled_tools or tool_name_from_server in enabled_tools:
                tool_name = f"custom_{server_name.replace(' ', '_').lower()}_{tool_name_from_server}"
                self.custom_tools[tool_name] = {
                    'name': tool_name,
                    'description': tool.description,
                    'parameters': tool.inputSchema,
                    'server': server_name,
                    'original_name': tool_name_from_server,
                    'is_custom': True,
                    'custom_type': custom_type,
                    'custom_config': server_config
                }
                tools_registered += 1
                logger.debug(f"Registered custom tool: {tool_name}")
        
        logger.info(f"Successfully initialized custom MCP {server_name} with {tools_registered} tools")
    
    def _register_custom_tools_from_info(self, tools_info: List[Dict[str, Any]], server_name: str, enabled_tools: List[str], custom_type: str, server_config: Dict[str, Any]):
        tools_registered = 0
        
        for tool_info in tools_info:
            tool_name_from_server = tool_info['name']
            if not enabled_tools or tool_name_from_server in enabled_tools:
                tool_name = f"custom_{server_name.replace(' ', '_').lower()}_{tool_name_from_server}"
                self.custom_tools[tool_name] = {
                    'name': tool_name,
                    'description': tool_info['description'],
                    'parameters': tool_info['input_schema'],
                    'server': server_name,
                    'original_name': tool_name_from_server,
                    'is_custom': True,
                    'custom_type': custom_type,
                    'custom_config': server_config
                }
                tools_registered += 1
                logger.debug(f"Registered custom tool: {tool_name}")
        
        logger.info(f"Successfully initialized custom MCP {server_name} with {tools_registered} tools")
    
    def get_custom_tools(self) -> Dict[str, Dict[str, Any]]:
        return self.custom_tools.copy() 