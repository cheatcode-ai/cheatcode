"""
FastAPI routes for Composio integration.
Main API endpoints for toolkit discovery, profile management, and OAuth flows.
"""

from fastapi import APIRouter, HTTPException, Depends, Query, Request
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from utils.logger import logger
from utils.auth_utils import get_current_user_id_from_jwt
from services.supabase import DBConnection
from .toolkit_service import ToolkitService, ToolkitInfo
from .connected_account_service import ConnectedAccountService
from .mcp_server_service import MCPServerService
from .profile_service import ProfileService, CreateProfileRequest, UpdateProfileRequest
from .client import verify_composio_connection

router = APIRouter(prefix="/composio", tags=["composio"])

# Database connection singleton
_db: Optional[DBConnection] = None


def get_db() -> DBConnection:
    """Get the database connection."""
    global _db
    if _db is None:
        _db = DBConnection()
    return _db


def initialize(database: DBConnection):
    """Initialize the API with a database connection."""
    global _db
    _db = database


# ============================================================================
# Request/Response Models
# ============================================================================

class CreateOAuthProfileRequest(BaseModel):
    """Request to create a profile with OAuth flow."""
    toolkit_slug: str
    profile_name: str
    display_name: Optional[str] = None
    redirect_url: Optional[str] = None
    initiation_params: Optional[Dict[str, Any]] = None
    use_custom_auth: bool = False
    custom_auth_config: Optional[Dict[str, Any]] = None


class CreateOAuthProfileResponse(BaseModel):
    """Response from creating a profile with OAuth."""
    success: bool
    profile_id: str
    redirect_url: Optional[str] = None
    connection_id: Optional[str] = None
    message: str


class ProfileResponse(BaseModel):
    """Single profile response."""
    success: bool
    profile: Dict[str, Any]


class ProfilesListResponse(BaseModel):
    """List of profiles response."""
    success: bool
    profiles: List[Dict[str, Any]]
    count: int


class ToolkitsResponse(BaseModel):
    """List of toolkits response."""
    success: bool
    toolkits: List[Dict[str, Any]]
    next_cursor: Optional[str] = None
    total: int


class MCPConfigResponse(BaseModel):
    """MCP configuration response."""
    success: bool
    mcp_url: str
    app_name: str
    enabled_tools: List[str] = Field(default_factory=list)


class ToolsResponse(BaseModel):
    """Tools list response."""
    success: bool
    tools: List[Dict[str, Any]]
    count: int


# ============================================================================
# Health & Status Endpoints
# ============================================================================

@router.get("/health")
async def health_check():
    """Check Composio integration health."""
    status = await verify_composio_connection()
    return status


# ============================================================================
# Category Endpoints
# ============================================================================

@router.get("/categories")
async def list_categories():
    """List available toolkit categories."""
    service = ToolkitService()
    categories = await service.list_categories()
    return {"success": True, "categories": categories}


# ============================================================================
# Toolkit Endpoints
# ============================================================================

@router.get("/toolkits", response_model=ToolkitsResponse)
async def list_toolkits(
    category: Optional[str] = Query(None, description="Filter by category"),
    search: Optional[str] = Query(None, description="Search term"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
    limit: int = Query(50, le=100, description="Max results per page")
):
    """
    List available toolkits with optional filtering.

    Returns toolkits that support OAuth/API key authentication.
    """
    try:
        service = ToolkitService()
        result = await service.list_toolkits(
            category=category,
            search=search,
            cursor=cursor,
            limit=limit
        )

        return ToolkitsResponse(
            success=True,
            toolkits=[t.model_dump() for t in result.toolkits],
            next_cursor=result.next_cursor,
            total=result.total
        )
    except Exception as e:
        logger.error(f"Failed to list toolkits: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/toolkits/{slug}/icon")
async def get_toolkit_icon(slug: str):
    """Get toolkit icon URL."""
    service = ToolkitService()
    icon_url = await service.get_toolkit_icon(slug)
    return {"success": True, "icon_url": icon_url}


@router.get("/toolkits/{slug}/details")
async def get_toolkit_details(slug: str):
    """Get detailed toolkit information."""
    service = ToolkitService()
    toolkit = await service.get_toolkit_details(slug)

    if not toolkit:
        raise HTTPException(status_code=404, detail=f"Toolkit '{slug}' not found")

    return {"success": True, "toolkit": toolkit.model_dump()}


# ============================================================================
# Profile Endpoints
# ============================================================================

@router.get("/profiles", response_model=ProfilesListResponse)
async def list_profiles(
    toolkit_slug: Optional[str] = Query(None, description="Filter by toolkit"),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """List user's Composio profiles."""
    try:
        db = get_db()
        service = ProfileService(db)
        profiles = await service.list_profiles(user_id, toolkit_slug)

        return ProfilesListResponse(
            success=True,
            profiles=[p.model_dump() for p in profiles],
            count=len(profiles)
        )
    except Exception as e:
        logger.error(f"Failed to list profiles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# IMPORTANT: Static routes must be defined BEFORE dynamic routes
@router.get("/profiles/check-name-availability")
async def check_profile_name(
    toolkit_slug: str = Query(..., description="Toolkit slug"),
    profile_name: str = Query(..., description="Proposed profile name"),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Check if a profile name is available."""
    db = get_db()
    service = ProfileService(db)
    is_available = await service.check_name_availability(
        user_id, toolkit_slug, profile_name
    )
    return {"success": True, "available": is_available}


@router.get("/profiles/{profile_id}", response_model=ProfileResponse)
async def get_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get a specific profile."""
    db = get_db()
    service = ProfileService(db)
    profile = await service.get_profile(profile_id, user_id)

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    return ProfileResponse(success=True, profile=profile.model_dump())


@router.post("/profiles", response_model=CreateOAuthProfileResponse)
async def create_profile(
    request: CreateOAuthProfileRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """
    Create a new Composio profile with OAuth flow.

    This initiates an OAuth connection with Composio and creates a local profile.
    Returns a redirect_url for the OAuth flow.
    """
    logger.info(f"Creating profile for toolkit {request.toolkit_slug}, user {user_id}")

    try:
        db = get_db()
        profile_service = ProfileService(db)

        # Check name availability
        is_available = await profile_service.check_name_availability(
            user_id, request.toolkit_slug, request.profile_name
        )
        if not is_available:
            raise HTTPException(
                status_code=400,
                detail=f"Profile name '{request.profile_name}' already exists for {request.toolkit_slug}"
            )

        # Initiate OAuth connection with Composio
        account_service = ConnectedAccountService()
        connection = await account_service.initiate_connection(
            user_id=user_id,
            app_name=request.toolkit_slug,
            redirect_url=request.redirect_url,
            initiation_params=request.initiation_params,
            auth_config=request.custom_auth_config if request.use_custom_auth else None
        )

        # Create profile with connection ID
        profile_request = CreateProfileRequest(
            toolkit_slug=request.toolkit_slug,
            profile_name=request.profile_name,
            display_name=request.display_name,
            connected_account_id=connection.id
        )
        profile = await profile_service.create_profile(user_id, profile_request)

        return CreateOAuthProfileResponse(
            success=True,
            profile_id=profile.profile_id,
            redirect_url=connection.redirect_url,
            connection_id=connection.id,
            message="Profile created. Complete OAuth to activate."
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/profiles/{profile_id}")
async def update_profile(
    profile_id: str,
    request: UpdateProfileRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Update a profile."""
    db = get_db()
    service = ProfileService(db)
    updated = await service.update_profile(profile_id, user_id, request)

    if not updated:
        raise HTTPException(status_code=404, detail="Profile not found")

    return {"success": True, "profile": updated.model_dump()}


@router.delete("/profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Delete a profile."""
    db = get_db()
    service = ProfileService(db)
    success = await service.delete_profile(profile_id, user_id)

    if not success:
        raise HTTPException(status_code=404, detail="Profile not found or delete failed")

    return {"success": True, "message": "Profile deleted"}


@router.get("/profiles/{profile_id}/mcp-config", response_model=MCPConfigResponse)
async def get_mcp_config(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get MCP configuration for a profile."""
    db = get_db()
    profile_service = ProfileService(db)
    profile = await profile_service.get_profile(profile_id, user_id)

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    mcp_service = MCPServerService()
    mcp_url = await mcp_service.generate_mcp_url(
        profile.connected_account_id,
        user_id
    )

    # Update last used timestamp
    await profile_service.update_last_used(profile_id, user_id)

    return MCPConfigResponse(
        success=True,
        mcp_url=mcp_url,
        app_name=profile.toolkit_slug,
        enabled_tools=profile.enabled_tools
    )


# ============================================================================
# Tools Endpoints
# ============================================================================

@router.get("/tools/list", response_model=ToolsResponse)
async def list_tools(
    toolkit_slug: str = Query(..., description="Toolkit slug"),
    limit: int = Query(100, le=200, description="Max tools to return"),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """List available tools for a toolkit (before connection)."""
    try:
        mcp_service = MCPServerService()
        tools = await mcp_service.list_tools_for_app(toolkit_slug, limit)

        return ToolsResponse(
            success=True,
            tools=[t.model_dump() for t in tools],
            count=len(tools)
        )
    except Exception as e:
        logger.error(f"Failed to list tools: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/discover-tools/{profile_id}")
async def discover_tools(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Discover available tools for a connected profile."""
    db = get_db()
    profile_service = ProfileService(db)
    profile = await profile_service.get_profile(profile_id, user_id)

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    mcp_service = MCPServerService()

    # Try MCP discovery first
    mcp_url = await mcp_service.generate_mcp_url(
        profile.connected_account_id,
        user_id
    )
    tools = await mcp_service.discover_tools(mcp_url, profile.connected_account_id)

    # Fallback to REST API if MCP discovery fails
    if not tools:
        tools = await mcp_service.discover_tools_via_api(
            profile.connected_account_id,
            profile.toolkit_slug
        )

    return {
        "success": True,
        "tools": [t.model_dump() for t in tools],
        "count": len(tools),
        "mcp_url": mcp_url
    }


@router.put("/profiles/{profile_id}/tools")
async def update_enabled_tools(
    profile_id: str,
    enabled_tools: List[str],
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Update the enabled tools for a profile."""
    db = get_db()
    service = ProfileService(db)

    request = UpdateProfileRequest(enabled_tools=enabled_tools)
    updated = await service.update_profile(profile_id, user_id, request)

    if not updated:
        raise HTTPException(status_code=404, detail="Profile not found")

    return {"success": True, "enabled_tools": updated.enabled_tools}


# ============================================================================
# Connection Status Endpoints
# ============================================================================

@router.get("/connections/status/{connection_id}")
async def get_connection_status(
    connection_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Check the status of an OAuth connection."""
    account_service = ConnectedAccountService()
    status = await account_service.get_connection_status(connection_id)

    return {
        "success": True,
        "connection_id": connection_id,
        "status": status.status,
        "connected_account_id": status.connected_account_id,
        "error": status.error
    }


@router.get("/connections")
async def list_connections(
    app_name: Optional[str] = Query(None, description="Filter by app"),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """List all OAuth connections for the user."""
    account_service = ConnectedAccountService()
    connections = await account_service.list_connections(user_id, app_name)

    return {
        "success": True,
        "connections": [
            {
                "id": c.id,
                "app_name": c.app_name,
                "status": c.status,
                "created_at": c.created_at
            }
            for c in connections
        ],
        "count": len(connections)
    }


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Delete an OAuth connection."""
    account_service = ConnectedAccountService()
    success = await account_service.delete_connection(connection_id)

    if not success:
        raise HTTPException(status_code=404, detail="Connection not found or delete failed")

    return {"success": True, "message": "Connection deleted"}
