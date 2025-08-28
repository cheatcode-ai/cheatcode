from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import asyncio
import time

from utils.logger import logger
from utils.auth_utils import get_current_user_id_from_jwt
from .client import get_pipedream_client
from .profiles import (
    get_profile_manager, 
    PipedreamProfile, 
    CreateProfileRequest, 
    UpdateProfileRequest
)

router = APIRouter(prefix="/pipedream", tags=["pipedream"])
db = None

def initialize(database):
    """Initialize the pipedream API with database connection."""
    global db
    db = database

class CreateConnectionTokenRequest(BaseModel):
    app: Optional[str] = None

class ConnectionTokenResponse(BaseModel):
    success: bool
    link: Optional[str] = None
    token: Optional[str] = None
    external_user_id: str
    app: Optional[str] = None
    expires_at: Optional[str] = None
    error: Optional[str] = None

class ConnectionResponse(BaseModel):
    success: bool
    connections: List[Dict[str, Any]]
    count: int
    error: Optional[str] = None

class HealthCheckResponse(BaseModel):
    status: str
    project_id: str
    environment: str
    has_access_token: bool
    error: Optional[str] = None

class TriggerWorkflowRequest(BaseModel):
    workflow_id: str
    payload: Dict[str, Any]

class TriggerWorkflowResponse(BaseModel):
    success: bool
    workflow_id: str
    run_id: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None

class MCPDiscoveryRequest(BaseModel):
    app_slug: Optional[str] = None
    oauth_app_id: Optional[str] = None

class MCPProfileDiscoveryRequest(BaseModel):
    external_user_id: str
    app_slug: Optional[str] = None
    oauth_app_id: Optional[str] = None

class MCPDiscoveryResponse(BaseModel):
    success: bool
    mcp_servers: List[Dict[str, Any]]
    count: int
    error: Optional[str] = None

class MCPConnectionRequest(BaseModel):
    app_slug: str
    oauth_app_id: Optional[str] = None

class MCPConnectionResponse(BaseModel):
    success: bool
    mcp_config: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@router.post("/connection-token", response_model=ConnectionTokenResponse)
async def create_connection_token(
    request: CreateConnectionTokenRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Creating Pipedream connection token for user: {user_id}, app: {request.app}")
    
    try:
        client = get_pipedream_client()
        result = await client.create_connection_token(user_id, request.app)
        
        logger.info(f"Successfully created connection token for user: {user_id}")
        return ConnectionTokenResponse(
            success=True,
            link=result.get("connect_link_url"),
            token=result.get("token"),
            external_user_id=user_id,
            app=request.app,
            expires_at=result.get("expires_at")
        )
        
    except Exception as e:
        logger.error(f"Failed to create connection token for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create connection token: {str(e)}"
        )

@router.get("/connections", response_model=ConnectionResponse)
async def get_user_connections(
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Getting Pipedream connections for user: {user_id}")
    try:
        client = get_pipedream_client()
        connections = await client.get_connections(user_id)
        
        logger.info(f"Successfully retrieved {len(connections)} connections for user: {user_id}")
        return ConnectionResponse(
            success=True,
            connections=connections,
            count=len(connections)
        )
        
    except Exception as e:
        logger.error(f"Failed to get connections for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get connections: {str(e)}"
        )

@router.post("/mcp/discover", response_model=MCPDiscoveryResponse)
async def discover_mcp_servers(
    request: MCPDiscoveryRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Discovering MCP servers for user: {user_id}, app: {request.app_slug}")
    
    try:
        client = get_pipedream_client()
        mcp_servers = await client.discover_mcp_servers(
            external_user_id=user_id,
            app_slug=request.app_slug,
            oauth_app_id=request.oauth_app_id
        )
        
        logger.info(f"Successfully discovered {len(mcp_servers)} MCP servers for user: {user_id}")
        return MCPDiscoveryResponse(
            success=True,
            mcp_servers=mcp_servers,
            count=len(mcp_servers)
        )
        
    except Exception as e:
        logger.error(f"Failed to discover MCP servers for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to discover MCP servers: {str(e)}"
        )

@router.post("/mcp/discover-profile", response_model=MCPDiscoveryResponse)
async def discover_mcp_servers_for_profile(
    request: MCPProfileDiscoveryRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Discover MCP servers for a specific profile's external_user_id"""
    logger.info(f"Discovering MCP servers for external_user_id: {request.external_user_id}, app: {request.app_slug}")
    
    try:
        client = get_pipedream_client()
        mcp_servers = await client.discover_mcp_servers(
            external_user_id=request.external_user_id,
            app_slug=request.app_slug,
            oauth_app_id=request.oauth_app_id
        )
        
        logger.info(f"Successfully discovered {len(mcp_servers)} MCP servers for external_user_id: {request.external_user_id}")
        return MCPDiscoveryResponse(
            success=True,
            mcp_servers=mcp_servers,
            count=len(mcp_servers)
        )
        
    except Exception as e:
        logger.error(f"Failed to discover MCP servers for external_user_id {request.external_user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to discover MCP servers: {str(e)}"
        )

@router.post("/mcp/connect", response_model=MCPConnectionResponse)
async def create_mcp_connection(
    request: MCPConnectionRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Creating MCP connection for user: {user_id}, app: {request.app_slug}")
    try:
        client = get_pipedream_client()
        mcp_config = await client.create_mcp_connection(
            external_user_id=user_id,
            app_slug=request.app_slug,
            oauth_app_id=request.oauth_app_id
        )
        logger.info(f"Successfully created MCP connection for user: {user_id}, app: {request.app_slug}")
        return MCPConnectionResponse(
            success=True,
            mcp_config=mcp_config
        )
    except Exception as e:
        logger.error(f"Failed to create MCP connection for user {user_id}, app {request.app_slug}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create MCP connection: {str(e)}"
        )

@router.post("/mcp/discover-custom", response_model=Dict[str, Any])
async def discover_pipedream_mcp_tools(
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Discovering all Pipedream MCP tools for user: {user_id}")
    
    try:
        client = get_pipedream_client()
        
        mcp_servers = await client.discover_mcp_servers(
            external_user_id=user_id
        )
        custom_mcps = []
        for server in mcp_servers:
            if server.get('status') == 'connected':
                custom_mcp = {
                    'name': server['app_name'],
                    'type': 'pipedream',
                    'config': {
                        'app_slug': server['app_slug'],
                        'external_user_id': user_id,
                        'oauth_app_id': server.get('oauth_app_id')
                    },
                    'tools': server.get('available_tools', []),
                    'count': len(server.get('available_tools', []))
                }
                custom_mcps.append(custom_mcp)
        
        logger.info(f"Found {len(custom_mcps)} Pipedream MCP servers for user: {user_id}")
        
        return {
            "success": True,
            "servers": custom_mcps,
            "count": len(custom_mcps)
        }
        
    except Exception as e:
        logger.error(f"Failed to discover Pipedream MCP tools for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to discover Pipedream MCP tools: {str(e)}"
        )

@router.get("/mcp/available-tools", response_model=Dict[str, Any])
async def get_available_pipedream_tools(
    user_id: str = Depends(get_current_user_id_from_jwt),
    force_refresh: bool = Query(False, description="Force refresh tools from Pipedream")
):
    logger.info(f"Getting available Pipedream MCP tools for user: {user_id}, force_refresh: {force_refresh}")
    
    try:
        client = get_pipedream_client()
        
        # Add retry logic for better reliability
        max_retries = 3
        retry_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                # Refresh rate limit token if this is a retry or forced refresh
                if attempt > 0 or force_refresh:
                    logger.info(f"Refreshing rate limit token (attempt {attempt + 1})")
                    await client.refresh_rate_limit_token()
                
                # Discover MCP servers with timeout
                mcp_servers = await client.discover_mcp_servers(
                    external_user_id=user_id
                )
                
                apps_with_tools = []
                total_tools = 0
                
                for server in mcp_servers:
                    if server.get('status') == 'connected':
                        tools = server.get('available_tools', [])
                        if tools:  # Only include apps that actually have tools
                            app_info = {
                                'app_name': server['app_name'],
                                'app_slug': server['app_slug'],
                                'tools': tools,
                                'tool_count': len(tools)
                            }
                            apps_with_tools.append(app_info)
                            total_tools += len(tools)
                            logger.info(f"Found {len(tools)} tools for {server['app_name']}")
                        else:
                            logger.warning(f"App {server['app_name']} is connected but has no tools")
                    else:
                        logger.warning(f"App {server.get('app_name', 'unknown')} has status: {server.get('status')}")
                
                logger.info(f"Successfully retrieved {len(apps_with_tools)} apps with {total_tools} total tools")
                
                return {
                    "success": True,
                    "apps": apps_with_tools,
                    "total_apps": len(apps_with_tools),
                    "total_tools": total_tools,
                    "user_id": user_id,
                    "timestamp": int(time.time())
                }
                
            except Exception as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Attempt {attempt + 1} failed, retrying in {retry_delay}s: {str(e)}")
                    await asyncio.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                    continue
                else:
                    raise e
        
    except Exception as e:
        logger.error(f"Failed to get available Pipedream tools for user {user_id}: {str(e)}")
        
        # Return a more detailed error response
        error_message = str(e)
        if "MCP not available" in error_message:
            error_message = "MCP service is not available. Please check your configuration."
        elif "No connected apps" in error_message:
            error_message = "No apps are connected to your Pipedream account."
        elif "timeout" in error_message.lower():
            error_message = "Request timed out. Please try again."
        elif "rate limit" in error_message.lower():
            error_message = "Rate limit exceeded. Please wait a moment and try again."
        
        return {
            "success": False,
            "error": error_message,
            "apps": [],
            "total_apps": 0,
            "total_tools": 0,
            "user_id": user_id,
            "timestamp": int(time.time())
        }

@router.get("/apps", response_model=Dict[str, Any])
async def get_pipedream_apps(
    page: int = Query(1, ge=1),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None)
):
    logger.info(f"Fetching Pipedream apps registry, page: {page}")
    
    # Curated list of featured apps (shown first) - verified through discovery script
    # Ordered by popularity (featured_weight) and category diversity
    FEATURED_APPS = [
        # Top productivity & collaboration (1M+ weight)
        "notion", "google_sheets", "google_drive", "google_calendar", 
        "supabase", "slack", "microsoft_teams",
        
        # Development & databases (100K+ weight)  
        "github", "aws", "stripe", "salesforce_rest_api", "hubspot",
        "woocommerce", "mongodb", "mysql", "postgresql",
        
        # Communication & marketing (10K+ weight)
        "gmail", "telegram_bot_api", "sendgrid", "klaviyo", "zendesk",
        "zoom", "twilio", "discord", "mailchimp",
        
        # Forms, productivity & file storage
        "airtable_oauth", "typeform", "google_forms", "dropbox", 
        "trello", "asana", "jira", "todoist", "clickup",
        
        # E-commerce & design
        "shopify_developer_app", "figma", "linkedin", "google_analytics"
    ]
    
    try:
        from pipedream.client import get_pipedream_client
        
        # Use the authenticated Pipedream client
        client = get_pipedream_client()
        access_token = await client._obtain_access_token()
        
        # Use the proper Pipedream API endpoint with authentication
        url = f"{client.base_url}/apps"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        
        params = {}
        if search:
            params["q"] = search  # Pipedream API uses 'q' for search
        if page > 1:
            # Pipedream API uses cursor-based pagination, not page numbers
            # For now, we'll just return the first page
            logger.warning(f"Page {page} requested, but Pipedream API uses cursor-based pagination. Returning first page.")
        
        session = await client._get_session()
        response = await session.get(url, headers=headers, params=params)
        response.raise_for_status()
        
        data = response.json()
        apps = data.get("data", [])
        
        # Apply curation logic (only if no search query to preserve search results)
        if not search:
            # Separate featured and non-featured apps
            featured_apps = []
            other_apps = []
            featured_slugs = set(FEATURED_APPS)
            
            for app in apps:
                app_slug = app.get("name_slug", "").lower()
                if app_slug in featured_slugs:
                    featured_apps.append(app)
                else:
                    other_apps.append(app)
            
            # Sort featured apps by the order in FEATURED_APPS list
            featured_apps.sort(key=lambda app: FEATURED_APPS.index(app.get("name_slug", "").lower()) 
                             if app.get("name_slug", "").lower() in FEATURED_APPS else len(FEATURED_APPS))
            
            # Combine: featured first, then others
            curated_apps = featured_apps + other_apps
            
            logger.info(f"Applied curation: {len(featured_apps)} featured apps, {len(other_apps)} other apps")
        else:
            curated_apps = apps
            logger.info(f"Search query provided, skipping curation")
        
        logger.info(f"Successfully fetched {len(curated_apps)} apps from Pipedream registry")
        return {
            "success": True,
            "apps": curated_apps,
            "page_info": data.get("page_info", {}),
            "total_count": data.get("page_info", {}).get("total_count", 0)
        }
        
    except Exception as e:
        logger.error(f"Failed to fetch Pipedream apps: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch Pipedream apps: {str(e)}"
        )

@router.post("/profiles", response_model=PipedreamProfile)
async def create_credential_profile(
    request: CreateProfileRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Creating credential profile for user: {user_id}, app: {request.app_slug}")
    
    try:
        profile_manager = get_profile_manager(db)
        profile = await profile_manager.create_profile(user_id, request)
        
        logger.info(f"Successfully created credential profile: {profile.profile_id}")
        return profile
        
    except Exception as e:
        logger.error(f"Failed to create credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create credential profile: {str(e)}"
        )

@router.get("/profiles", response_model=List[PipedreamProfile])
async def get_credential_profiles(
    app_slug: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Getting credential profiles for user: {user_id}, app: {app_slug}")
    
    try:
        profile_manager = get_profile_manager(db)
        profiles = await profile_manager.get_profiles(user_id, app_slug, is_active)
        
        logger.info(f"Successfully retrieved {len(profiles)} credential profiles")
        return profiles
        
    except Exception as e:
        logger.error(f"Failed to get credential profiles: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get credential profiles: {str(e)}"
        )

@router.get("/profiles/{profile_id}", response_model=PipedreamProfile)
async def get_credential_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Getting credential profile: {profile_id} for user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        profile = await profile_manager.get_profile(user_id, profile_id)
        
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        logger.info(f"Successfully retrieved credential profile: {profile_id}")
        return profile
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get credential profile: {str(e)}"
        )

@router.put("/profiles/{profile_id}", response_model=PipedreamProfile)
async def update_credential_profile(
    profile_id: str,
    request: UpdateProfileRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    logger.info(f"Updating credential profile: {profile_id} for user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        profile = await profile_manager.update_profile(user_id, profile_id, request)
        
        logger.info(f"Successfully updated credential profile: {profile_id}")
        return profile
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to update credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update credential profile: {str(e)}"
        )

@router.delete("/profiles/{profile_id}")
async def delete_credential_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Delete a credential profile"""
    logger.info(f"Deleting credential profile: {profile_id} for user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        deleted = await profile_manager.delete_profile(user_id, profile_id)
        
        if not deleted:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        logger.info(f"Successfully deleted credential profile: {profile_id}")
        return {"success": True, "message": "Profile deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete credential profile: {str(e)}"
        )

@router.post("/profiles/{profile_id}/connect")
async def connect_credential_profile(
    profile_id: str,
    app: Optional[str] = Query(None),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Generate connection token for a specific credential profile"""
    logger.info(f"Connecting credential profile: {profile_id} for user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        result = await profile_manager.connect_profile(user_id, profile_id, app)
        
        logger.info(f"Successfully generated connection token for profile: {profile_id}")
        return result
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to connect credential profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to connect credential profile: {str(e)}"
        )

@router.get("/profiles/{profile_id}/connections")
async def get_profile_connections(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get connections for a specific credential profile"""
    logger.info(f"Getting connections for profile: {profile_id}, user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        connections = await profile_manager.get_profile_connections(user_id, profile_id)
        
        logger.info(f"Successfully retrieved {len(connections)} connections for profile: {profile_id}")
        return {
            "success": True,
            "connections": connections,
            "count": len(connections)
        }
        
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get profile connections: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get profile connections: {str(e)}"
        )

@router.post("/profiles/{profile_id}/auto-enable-tools")
async def auto_enable_tools_for_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Auto-enable all available tools for an existing profile"""
    logger.info(f"Auto-enabling tools for profile: {profile_id}, user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        profile = await profile_manager.get_profile(user_id, profile_id)
        
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
        
        if not profile.is_connected:
            raise HTTPException(status_code=400, detail="Profile is not connected")
        
        # Discover all available tools for this app
        try:
            mcp_servers = await profile_manager.pipedream_client.discover_mcp_servers(
                external_user_id=profile.external_user_id,
                app_slug=profile.app_slug
            )
            
            enabled_tools = []
            for server in mcp_servers:
                if server.get('app_slug') == profile.app_slug and server.get('status') == 'connected':
                    available_tools = server.get('available_tools', [])
                    enabled_tools = [tool['name'] for tool in available_tools if 'name' in tool]
                    break
            
            if not enabled_tools:
                raise HTTPException(
                    status_code=400, 
                    detail="No tools available for this app or app not properly connected"
                )
            
            # Update the profile with auto-enabled tools
            from .profiles import UpdateProfileRequest
            update_request = UpdateProfileRequest(enabled_tools=enabled_tools)
            updated_profile = await profile_manager.update_profile(user_id, profile_id, update_request)
            
            logger.info(f"Auto-enabled {len(enabled_tools)} tools for profile {profile_id}: {enabled_tools}")
            
            return {
                "success": True,
                "message": f"Auto-enabled {len(enabled_tools)} tools",
                "enabled_tools": enabled_tools,
                "profile": updated_profile
            }
            
        except Exception as e:
            logger.error(f"Error auto-enabling tools: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to auto-enable tools: {str(e)}"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to auto-enable tools for profile: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to auto-enable tools for profile: {str(e)}"
        )

@router.post("/auto-enable-all-tools")
async def auto_enable_tools_for_all_profiles(
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Auto-enable tools for all connected profiles that don't have tools enabled"""
    logger.info(f"Auto-enabling tools for all profiles for user: {user_id}")
    
    try:
        profile_manager = get_profile_manager(db)
        profiles = await profile_manager.get_profiles(user_id)
        
        updated_profiles = []
        errors = []
        
        for profile in profiles:
            if not profile.is_connected:
                continue
                
            # Skip if profile already has tools enabled
            if profile.enabled_tools and len(profile.enabled_tools) > 0:
                continue
            
            try:
                # Auto-discover tools for this profile
                mcp_servers = await profile_manager.pipedream_client.discover_mcp_servers(
                    external_user_id=profile.external_user_id,
                    app_slug=profile.app_slug
                )
                
                enabled_tools = []
                for server in mcp_servers:
                    if server.get('app_slug') == profile.app_slug and server.get('status') == 'connected':
                        available_tools = server.get('available_tools', [])
                        enabled_tools = [tool['name'] for tool in available_tools if 'name' in tool]
                        break
                
                if enabled_tools:
                    from .profiles import UpdateProfileRequest
                    update_request = UpdateProfileRequest(enabled_tools=enabled_tools)
                    updated_profile = await profile_manager.update_profile(user_id, profile.profile_id, update_request)
                    updated_profiles.append({
                        "profile_id": profile.profile_id,
                        "app_name": profile.app_name,
                        "tools_count": len(enabled_tools),
                        "tools": enabled_tools
                    })
                    logger.info(f"Auto-enabled {len(enabled_tools)} tools for {profile.app_name} profile")
                
            except Exception as e:
                logger.warning(f"Failed to auto-enable tools for profile {profile.profile_id}: {str(e)}")
                errors.append({
                    "profile_id": profile.profile_id,
                    "app_name": profile.app_name,
                    "error": str(e)
                })
        
        return {
            "success": True,
            "message": f"Auto-enabled tools for {len(updated_profiles)} profiles",
            "updated_profiles": updated_profiles,
            "errors": errors
        }
        
    except Exception as e:
        logger.error(f"Failed to auto-enable tools for all profiles: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to auto-enable tools for all profiles: {str(e)}"
        )

@router.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """Check the health of the Pipedream integration"""
    logger.info("Health check endpoint called")
    
    try:
        client = get_pipedream_client()
        
        # First, validate the configuration
        config_status = client.validate_config()
        if not config_status["valid"]:
            logger.error(f"Pipedream configuration invalid: {config_status['error']}")
            return HealthCheckResponse(
                status="unhealthy",
                project_id=config_status["project_id"] or "unknown",
                environment=config_status["environment"] or "unknown",
                has_access_token=False,
                error=f"Configuration error: {config_status['error']}"
            )
        
        # Test that we can obtain an access token
        access_token = await client._obtain_access_token()
        has_access_token = bool(access_token)
        
        logger.info(f"Pipedream health check successful - has_access_token: {has_access_token}")
        return HealthCheckResponse(
            status="healthy",
            project_id=client.config.project_id,
            environment=client.config.environment,
            has_access_token=has_access_token
        )
        
    except Exception as e:
        logger.error(f"Pipedream health check failed: {str(e)}")
        
        # Try to get basic config info even if initialization failed
        try:
            client = get_pipedream_client()
            project_id = client.config.project_id
            environment = client.config.environment
        except:
            project_id = "unknown"
            environment = "unknown"
        
        return HealthCheckResponse(
            status="unhealthy",
            project_id=project_id,
            environment=environment,
            has_access_token=False,
            error=str(e)
        )
