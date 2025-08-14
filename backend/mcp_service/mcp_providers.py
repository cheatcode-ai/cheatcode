from typing import Dict, Any, Optional, Protocol
import os
from utils.logger import logger



class MCPProvider(Protocol):
    def get_server_url(self, qualified_name: str, config: Dict[str, Any]) -> str:
        ...
    
    def get_headers(self, qualified_name: str, config: Dict[str, Any], external_user_id: Optional[str] = None) -> Dict[str, str]:
        ...

class SmitheryProvider:
    def __init__(self):
        self.base_url = "https://server.smithery.ai"
        self.api_key = os.getenv("SMITHERY_API_KEY")
    
    def get_server_url(self, qualified_name: str, config: Dict[str, Any]) -> str:
        import json
        import base64
        
        config_json = json.dumps(config)
        config_b64 = base64.b64encode(config_json.encode()).decode()
        
        if not self.api_key:
            raise ValueError("SMITHERY_API_KEY environment variable is not set")
        
        return f"{self.base_url}/{qualified_name}/mcp?config={config_b64}&api_key={self.api_key}"
    
    def get_headers(self, qualified_name: str, config: Dict[str, Any], external_user_id: Optional[str] = None) -> Dict[str, str]:
        return {}

class PipedreamProvider:
    def __init__(self):
        self.base_url = "https://remote.mcp.pipedream.net"
        self.project_id = os.getenv("PIPEDREAM_PROJECT_ID")
        self.environment = os.getenv("PIPEDREAM_X_PD_ENVIRONMENT", "development")
    
    async def get_access_token(self) -> str:
        from pipedream.client import get_pipedream_client
        
        client = get_pipedream_client()
        return await client._obtain_access_token()
    
    def get_server_url(self, qualified_name: str, config: Dict[str, Any]) -> str:
        return self.base_url
    
    async def get_headers_async(self, qualified_name: str, config: Dict[str, Any], external_user_id: Optional[str] = None) -> Dict[str, str]:
        # Allow overriding project_id and environment from the decrypted MCP config.
        if not self.project_id:
            self.project_id = config.get("project_id") or config.get("pd_project_id")

        if not self.project_id:
            raise ValueError("PIPEDREAM_PROJECT_ID environment variable is not set and project_id not provided in MCP config")

        if not self.environment:
            self.environment = config.get("environment") or config.get("pd_environment", "development")
        
        if not external_user_id:
            raise ValueError("external_user_id is required for Pipedream MCP connections")
        
        access_token = await self.get_access_token()
        
        from pipedream.client import get_pipedream_client
        client = get_pipedream_client()
        await client._ensure_rate_limit_token()
        
        headers = {
            "Authorization": f"Bearer {access_token}",
            "x-pd-project-id": self.project_id,
            "x-pd-environment": self.environment,
            "x-pd-external-user-id": external_user_id,
            "x-pd-app-slug": qualified_name,
        }
        
        if client.rate_limit_token:
            headers["x-pd-rate-limit"] = client.rate_limit_token
        
        if config.get('oauth_app_id'):
            headers["x-pd-oauth-app-id"] = config['oauth_app_id']
        
        return headers
    
    def get_headers(self, qualified_name: str, config: Dict[str, Any], external_user_id: Optional[str] = None) -> Dict[str, str]:
        raise NotImplementedError("PipedreamProvider requires async header generation. Use get_headers_async instead.")


class MCPProviderFactory:
    _providers = {
        'smithery': SmitheryProvider,
        'pipedream': PipedreamProvider,
    }
    
    @classmethod
    def create_provider(cls, provider_type: str) -> MCPProvider:
        if provider_type not in cls._providers:
            raise ValueError(f"Unknown provider type: {provider_type}")
        
        return cls._providers[provider_type]()
    
 