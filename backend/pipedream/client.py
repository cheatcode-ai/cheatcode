import os
import asyncio
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
import httpx
from utils.logger import logger
import time
import random

try:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
except ImportError:
    logger.warning("MCP not available - MCP discovery will be disabled")
    ClientSession = None
    streamablehttp_client = None

@dataclass
class PipedreamConfig:
    project_id: str
    environment: str
    client_id: str
    client_secret: str

class PipedreamClient:
    def __init__(self, config: Optional[PipedreamConfig] = None):
        self.config = config or self._load_config_from_env()
        self.base_url = "https://api.pipedream.com/v1"
        self.access_token: Optional[str] = None
        self.rate_limit_token: Optional[str] = None
        self.session: Optional[httpx.AsyncClient] = None
        
    def _load_config_from_env(self) -> PipedreamConfig:
        project_id = os.getenv("PIPEDREAM_PROJECT_ID")
        environment = os.getenv("PIPEDREAM_X_PD_ENVIRONMENT", "development")
        client_id = os.getenv("PIPEDREAM_CLIENT_ID")
        client_secret = os.getenv("PIPEDREAM_CLIENT_SECRET")
        
        logger.debug(f"Loading Pipedream config from environment:")
        logger.debug(f"  PIPEDREAM_PROJECT_ID: {'SET' if project_id else 'NOT SET'}")
        logger.debug(f"  PIPEDREAM_X_PD_ENVIRONMENT: {environment}")
        logger.debug(f"  PIPEDREAM_CLIENT_ID: {'SET' if client_id else 'NOT SET'}")
        logger.debug(f"  PIPEDREAM_CLIENT_SECRET: {'SET' if client_secret else 'NOT SET'}")
        
        if not all([project_id, client_id, client_secret]):
            missing = []
            if not project_id:
                missing.append("PIPEDREAM_PROJECT_ID")
            if not client_id:
                missing.append("PIPEDREAM_CLIENT_ID")
            if not client_secret:
                missing.append("PIPEDREAM_CLIENT_SECRET")
            
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing)}. "
                "Please set these variables to use the Pipedream client."
            )
        
        return PipedreamConfig(
            project_id=project_id,
            environment=environment,
            client_id=client_id,
            client_secret=client_secret
        )

    def validate_config(self) -> dict:
        """Validate the Pipedream configuration and return status"""
        try:
            config = self.config
            return {
                "valid": True,
                "project_id": config.project_id,
                "environment": config.environment,
                "client_id_set": bool(config.client_id),
                "client_secret_set": bool(config.client_secret),
                "error": None
            }
        except Exception as e:
            return {
                "valid": False,
                "project_id": None,
                "environment": None,
                "client_id_set": False,
                "client_secret_set": False,
                "error": str(e)
            }
    
    async def _get_session(self) -> httpx.AsyncClient:
        if self.session is None or self.session.is_closed:
            self.session = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0),
                headers={"User-Agent": "CheatCode-AI-Pipedream-Client/1.0"}
            )
        return self.session

    async def _obtain_rate_limit_token(self, window_size_seconds: int = 10, requests_per_window: int = 1000) -> str:
        """Obtain a rate limit token from Pipedream to bypass rate limits"""
        if self.rate_limit_token:
            logger.debug(f"Using existing rate limit token: {self.rate_limit_token[:20]}...")
            return self.rate_limit_token
            
        access_token = await self._obtain_access_token()
        logger.info(f"Obtaining Pipedream rate limit token (window: {window_size_seconds}s, requests: {requests_per_window})")
        
        try:
            # Make this request without retry logic to avoid circular dependency
            session = await self._get_session()
            url = f"{self.base_url}/connect/rate_limits"
            payload = {
                "window_size_seconds": window_size_seconds,
                "requests_per_window": requests_per_window
            }
            
            logger.debug(f"Making POST request to {url} with payload: {payload}")
            
            response = await session.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {access_token}"
                },
                json=payload
            )
            
            logger.debug(f"Rate limit token request response: {response.status_code}")
            
            # Accept both 200 (OK) and 201 (Created) as successful responses
            if response.status_code not in [200, 201]:
                logger.error(f"Failed to obtain rate limit token: {response.status_code} - {response.text}")
                response.raise_for_status()
            
            data = response.json()
            logger.debug(f"Rate limit token response data: {data}")
            
            self.rate_limit_token = data.get("token")
            
            if not self.rate_limit_token:
                raise ValueError("No rate limit token received from Pipedream")
            
            logger.info(f"Successfully obtained Pipedream rate limit token: {self.rate_limit_token[:20]}...")
            return self.rate_limit_token
            
        except Exception as e:
            logger.error(f"Error obtaining rate limit token: {str(e)}")
            raise

    async def _make_request_with_retry(self, method: str, url: str, headers: dict, max_retries: int = 3, **kwargs) -> httpx.Response:
        session = await self._get_session()
        
        for attempt in range(max_retries + 1):
            try:
                # Always include rate limit token if available
                request_headers = headers.copy()
                if self.rate_limit_token:
                    request_headers["x-pd-rate-limit"] = self.rate_limit_token
                    logger.debug(f"Making {method} request to {url} with rate limit token: {self.rate_limit_token[:20]}...")
                else:
                    logger.debug(f"Making {method} request to {url} without rate limit token")
                
                response = await session.request(method, url, headers=request_headers, **kwargs)
                
                if response.status_code == 429:
                    if attempt < max_retries:
                        retry_after = response.headers.get('retry-after')
                        if retry_after:
                            wait_time = int(retry_after)
                        else:
                            wait_time = (2 ** attempt) + random.uniform(0, 1)
                        
                        logger.warning(f"Rate limited (429) even with token, retrying in {wait_time:.2f} seconds (attempt {attempt + 1}/{max_retries + 1})")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"Rate limit exceeded after {max_retries} retries for {method} {url}")
                
                response.raise_for_status()
                logger.debug(f"Successfully completed {method} request to {url} (status: {response.status_code})")
                return response
                
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    # Handle 401 Unauthorized - try refreshing access token
                    if attempt < max_retries:
                        logger.warning(f"Unauthorized (401) error, refreshing access token (attempt {attempt + 1}/{max_retries + 1})")
                        try:
                            # Refresh the access token
                            new_token = await self._refresh_access_token()
                            # Update the Authorization header with the new token
                            if "Authorization" in headers:
                                headers["Authorization"] = f"Bearer {new_token}"
                            continue
                        except Exception as refresh_error:
                            logger.error(f"Failed to refresh access token: {str(refresh_error)}")
                            # Continue to raise the original 401 error
                    logger.error(f"HTTP error for {method} {url}: {e.response.status_code} - {e.response.text}")
                    raise
                elif e.response.status_code == 429 and attempt < max_retries:
                    continue
                logger.error(f"HTTP error for {method} {url}: {e.response.status_code} - {e.response.text}")
                raise
            except Exception as e:
                if attempt < max_retries:
                    wait_time = (2 ** attempt) + random.uniform(0, 1)
                    logger.warning(f"Request failed, retrying in {wait_time:.2f} seconds (attempt {attempt + 1}/{max_retries + 1}): {str(e)}")
                    await asyncio.sleep(wait_time)
                    continue
                logger.error(f"Request failed after {max_retries} retries for {method} {url}: {str(e)}")
                raise
        
        raise Exception(f"Max retries ({max_retries}) exceeded for {method} {url}")

    async def _obtain_access_token(self) -> str:
        if self.access_token:
            return self.access_token
            
        logger.info("Obtaining Pipedream access token via OAuth")
        logger.debug(f"Using client_id: {self.config.client_id[:8]}... (masked)")
        logger.debug(f"Using project_id: {self.config.project_id}")
        logger.debug(f"Using environment: {self.config.environment}")
        
        try:
            # Make this request without retry logic to avoid issues
            session = await self._get_session()
            
            oauth_url = f"{self.base_url}/oauth/token"
            logger.debug(f"Making OAuth request to: {oauth_url}")
            
            response = await session.post(
                oauth_url,
                headers={"Content-Type": "application/json"},
                json={
                    "grant_type": "client_credentials",
                    "client_id": self.config.client_id,
                    "client_secret": self.config.client_secret
                }
            )
            
            logger.debug(f"OAuth response status: {response.status_code}")
            if response.status_code != 200:
                logger.error(f"OAuth request failed with status {response.status_code}: {response.text}")
            
            response.raise_for_status()
            data = response.json()
            
            self.access_token = data.get("access_token")
            if not self.access_token:
                raise ValueError("No access token received from Pipedream OAuth")
            
            logger.info("Successfully obtained Pipedream access token")
            logger.debug(f"Access token starts with: {self.access_token[:16]}... (masked)")
            return self.access_token
            
        except Exception as e:
            logger.error(f"Error obtaining access token: {str(e)}")
            raise

    async def _refresh_access_token(self) -> str:
        """Refresh the access token by clearing the cached token and obtaining a new one"""
        logger.info("Refreshing Pipedream access token")
        self.access_token = None  # Clear cached token
        return await self._obtain_access_token()

    async def refresh_rate_limit_token(self, window_size_seconds: int = 10, requests_per_window: int = 1000) -> str:
        """Manually refresh the rate limit token with custom parameters"""
        self.rate_limit_token = None  # Clear existing token
        return await self._obtain_rate_limit_token(window_size_seconds, requests_per_window)

    def clear_rate_limit_token(self) -> None:
        """Clear the stored rate limit token to force obtaining a new one"""
        self.rate_limit_token = None
        logger.info("Rate limit token cleared")

    def clear_access_token(self) -> None:
        """Clear the stored access token to force obtaining a new one"""
        self.access_token = None
        logger.info("Access token cleared")

    async def _ensure_rate_limit_token(self) -> None:
        """Ensure we have a rate limit token before making requests"""
        if not self.rate_limit_token:
            try:
                await self._obtain_rate_limit_token()
            except Exception as e:
                logger.warning(f"Failed to obtain rate limit token, proceeding without it: {str(e)}")
        else:
            logger.debug(f"Using existing rate limit token: {self.rate_limit_token[:20]}...")
    
    async def create_connection_token(self, external_user_id: str, app: Optional[str] = None) -> Dict[str, Any]:
        access_token = await self._obtain_access_token()
        await self._ensure_rate_limit_token()
        
        logger.info(f"Creating connection token for user: {external_user_id}, app: {app}")
        try:
            payload = {
                "external_user_id": external_user_id
            }
            # Pipedream expects a human-readable slug like "gmail" here. Passing the
            # internal numeric ID (e.g. "519") makes the generated link invalid and
            # the Connect page shows "link expired" immediately. Therefore include
            # `app` only when it contains at least one non-digit character.
            if app and not str(app).isdigit():
                payload["app"] = app
            
            response = await self._make_request_with_retry(
                "POST",
                f"{self.base_url}/connect/{self.config.project_id}/tokens",
                headers={
                    "Content-Type": "application/json",
                    "X-PD-Environment": self.config.environment,
                    "Authorization": f"Bearer {access_token}"
                },
                json=payload
            )
            data = response.json()
            if app and not str(app).isdigit() and "connect_link_url" in data:
                link = data["connect_link_url"]
                if "app=" not in link:
                    separator = "&" if "?" in link else "?"
                    data["connect_link_url"] = f"{link}{separator}app={app}"
            
            logger.info(f"Successfully created connection token for user: {external_user_id}")
            logger.info(f"Connection token: {data}")
            return data
            
        except Exception as e:
            logger.error(f"Error creating connection token: {str(e)}")
            raise
    
    async def get_connections(self, external_user_id: str) -> List[Dict[str, Any]]:
        access_token = await self._obtain_access_token()
        await self._ensure_rate_limit_token()
        
        logger.info(f"Getting connections for user: {external_user_id}")
        
        try:
            url = f"{self.base_url}/connect/{self.config.project_id}/accounts?external_id={external_user_id}"
            
            headers = {
                "X-PD-Environment": self.config.environment,
                "Authorization": f"Bearer {access_token}"
            }
            
            response = await self._make_request_with_retry(
                "GET",
                url,
                headers=headers
            )
            
            data = response.json()
            
            accounts = data.get("data", [])
            apps = [account.get("app") for account in accounts if account.get("app")]
            
            logger.info(f"Successfully retrieved {len(apps)} apps for user: {external_user_id}")
            return apps
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.info(f"User {external_user_id} not found in Pipedream, returning empty connections list")
                return []
            
            logger.error(f"HTTP error getting connections: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Error getting connections: {str(e)}")
            raise

    async def discover_mcp_servers(self, external_user_id: str, app_slug: Optional[str] = None, oauth_app_id: Optional[str] = None) -> List[Dict[str, Any]]:
        if not ClientSession or not streamablehttp_client:
            logger.error("MCP not available - cannot discover MCP servers")
            return []

        await self._ensure_rate_limit_token()
        logger.info(f"Discovering MCP servers for user: {external_user_id}, app: {app_slug}")
        user_apps = await self.get_connections(external_user_id)
        
        if not user_apps:
            logger.info(f"No connected apps found for user: {external_user_id}")
            return []

        if app_slug:
            user_apps = [app for app in user_apps if app.get('name_slug') == app_slug]
        
        mcp_servers = []
        for app in user_apps:
            app_slug_current = app.get('name_slug')
            app_name = app.get('name')
            
            if not app_slug_current:
                continue
                
            mcp_config = {
                'app_slug': app_slug_current,
                'app_name': app_name,
                'external_user_id': external_user_id,
                'oauth_app_id': oauth_app_id,
                'server_url': 'https://remote.mcp.pipedream.net',
                'project_id': self.config.project_id,
                'environment': self.config.environment,
            }
            
            try:
                tools = await self._test_mcp_connection(mcp_config)
                mcp_config['available_tools'] = tools
                mcp_config['status'] = 'connected'
                mcp_servers.append(mcp_config)
                logger.info(f"Successfully discovered MCP server for {app_name} ({app_slug_current}) with {len(tools)} tools")
            except Exception as e:
                logger.warning(f"Failed to connect to MCP server for {app_name} ({app_slug_current}): {str(e)}")
                mcp_config['status'] = 'error'
                mcp_config['error'] = str(e)
                mcp_servers.append(mcp_config)
        
        logger.info(f"Discovered {len(mcp_servers)} MCP servers for user: {external_user_id}")
        return mcp_servers

    async def _test_mcp_connection(self, mcp_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not ClientSession or not streamablehttp_client:
            raise Exception("MCP not available")
            
        access_token = await self._obtain_access_token()
        server_url = mcp_config['server_url']
        
        headers = {
            "Authorization": f"Bearer {access_token}",
            "x-pd-project-id": mcp_config['project_id'],
            "x-pd-environment": mcp_config['environment'],
            "x-pd-external-user-id": mcp_config['external_user_id'],
            "x-pd-app-slug": mcp_config['app_slug'],
        }
        
        if self.rate_limit_token:
            headers["x-pd-rate-limit"] = self.rate_limit_token
        
        if mcp_config.get('oauth_app_id'):
            headers["x-pd-oauth-app-id"] = mcp_config['oauth_app_id']
        
        async with asyncio.timeout(15):
            async with streamablehttp_client(server_url, headers=headers) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    tools_result = await session.list_tools()
                    tools = tools_result.tools if hasattr(tools_result, 'tools') else tools_result
                    tools_info = []
                    for tool in tools:
                        tool_info = {
                            "name": tool.name,
                            "description": tool.description,
                            "inputSchema": tool.inputSchema
                        }
                        tools_info.append(tool_info)
                    
                    return tools_info

    async def create_mcp_connection(self, external_user_id: str, app_slug: str, oauth_app_id: Optional[str] = None) -> Dict[str, Any]:
        if not ClientSession or not streamablehttp_client:
            raise Exception("MCP not available")
        
        await self._ensure_rate_limit_token()
            
        logger.info(f"Creating MCP connection for user: {external_user_id}, app: {app_slug}")
        
        user_apps = await self.get_connections(external_user_id)
        connected_app = None
        for app in user_apps:
            if app.get('name_slug') == app_slug:
                connected_app = app
                break
        
        if not connected_app:
            raise Exception(f"User {external_user_id} does not have {app_slug} connected")
        
        mcp_config = {
            'app_slug': app_slug,
            'app_name': connected_app.get('name'),
            'external_user_id': external_user_id,
            'oauth_app_id': oauth_app_id,
            'server_url': 'https://remote.mcp.pipedream.net',
            'project_id': self.config.project_id,
            'environment': self.config.environment,
        }
        
        try:
            tools = await self._test_mcp_connection(mcp_config)
            mcp_config['available_tools'] = tools
            mcp_config['status'] = 'connected'
            logger.info(f"Successfully created MCP connection for {app_slug} with {len(tools)} tools")
        except Exception as e:
            logger.error(f"Failed to create MCP connection for {app_slug}: {str(e)}")
            mcp_config['status'] = 'error'
            mcp_config['error'] = str(e)
            raise
        
        return mcp_config

    async def close(self):
        if self.session and not self.session.is_closed:
            await self.session.aclose()
    
    def __repr__(self) -> str:
        return f"PipedreamClient(project_id={self.config.project_id}, environment={self.config.environment})"
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()


_pipedream_client: Optional[PipedreamClient] = None

def get_pipedream_client() -> PipedreamClient:
    global _pipedream_client
    if _pipedream_client is None:
        _pipedream_client = PipedreamClient()
    return _pipedream_client

def initialize_pipedream_client(config: Optional[PipedreamConfig] = None) -> PipedreamClient:
    global _pipedream_client
    _pipedream_client = PipedreamClient(config)
    return _pipedream_client
