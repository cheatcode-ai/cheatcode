"""
Secure MCP API endpoints for Composio.
These endpoints handle sensitive operations like MCP URL retrieval and profile management.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from utils.logger import logger
from utils.auth_utils import get_current_user_id_from_jwt
from services.supabase import DBConnection
from .profile_service import ProfileService, UpdateProfileRequest
from .mcp_server_service import MCPServerService

router = APIRouter(prefix="/composio-secure", tags=["composio-secure"])

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

class BulkDeleteRequest(BaseModel):
    """Request to bulk delete profiles."""
    profile_ids: List[str]


class ToolkitWithProfiles(BaseModel):
    """Toolkit with its associated profiles."""
    toolkit_slug: str
    toolkit_name: str
    profiles: List[Dict[str, Any]]
    profile_count: int


class CredentialProfilesResponse(BaseModel):
    """Response with all credential profiles grouped by toolkit."""
    success: bool
    toolkits: List[ToolkitWithProfiles]
    total_profiles: int


class MCPUrlResponse(BaseModel):
    """Response with MCP URL for a profile."""
    success: bool
    mcp_url: str
    profile_id: str
    profile_name: str
    toolkit_slug: str


# ============================================================================
# Credential Profile Endpoints
# ============================================================================

@router.get("/composio-profiles", response_model=CredentialProfilesResponse)
async def get_credential_profiles(
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """
    Get all Composio credential profiles grouped by toolkit.

    This endpoint returns all profiles organized by their toolkit/app
    for displaying in the credentials management UI.
    """
    try:
        db = get_db()
        service = ProfileService(db)
        grouped = await service.get_profiles_grouped_by_toolkit(user_id)

        toolkits = []
        total = 0

        for toolkit_slug, profiles in grouped.items():
            toolkit_profiles = [p.model_dump() for p in profiles]
            total += len(toolkit_profiles)

            toolkits.append(ToolkitWithProfiles(
                toolkit_slug=toolkit_slug,
                toolkit_name=toolkit_slug.replace('_', ' ').title(),
                profiles=toolkit_profiles,
                profile_count=len(toolkit_profiles)
            ))

        # Sort toolkits alphabetically
        toolkits.sort(key=lambda t: t.toolkit_name)

        return CredentialProfilesResponse(
            success=True,
            toolkits=toolkits,
            total_profiles=total
        )

    except Exception as e:
        logger.error(f"Failed to get credential profiles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/composio-profiles/{profile_id}/mcp-url", response_model=MCPUrlResponse)
async def get_profile_mcp_url(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """
    Get MCP URL for a specific profile.

    This is a sensitive endpoint that returns the actual MCP server URL
    for connecting to the third-party service.
    """
    try:
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

        return MCPUrlResponse(
            success=True,
            mcp_url=mcp_url,
            profile_id=profile_id,
            profile_name=profile.profile_name,
            toolkit_slug=profile.toolkit_slug
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get MCP URL for profile {profile_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Profile Management Endpoints
# ============================================================================

@router.delete("/credential-profiles/{profile_id}", operation_id="delete_composio_credential_profile")
async def delete_credential_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Delete a Composio credential profile."""
    try:
        db = get_db()
        service = ProfileService(db)
        success = await service.delete_profile(profile_id, user_id)

        if not success:
            raise HTTPException(
                status_code=404,
                detail="Profile not found or delete failed"
            )

        logger.info(f"Deleted Composio profile {profile_id} for user {user_id}")
        return {"success": True, "message": "Profile deleted"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete profile {profile_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/credential-profiles/bulk-delete")
async def bulk_delete_profiles(
    request: BulkDeleteRequest,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Bulk delete credential profiles."""
    try:
        db = get_db()
        service = ProfileService(db)
        deleted = await service.bulk_delete_profiles(request.profile_ids, user_id)

        logger.info(f"Bulk deleted {deleted}/{len(request.profile_ids)} profiles for user {user_id}")

        return {
            "success": True,
            "deleted_count": deleted,
            "requested_count": len(request.profile_ids)
        }

    except Exception as e:
        logger.error(f"Failed to bulk delete profiles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/credential-profiles/{profile_id}/set-default")
async def set_default_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Set a profile as default for its toolkit."""
    try:
        db = get_db()
        service = ProfileService(db)
        success = await service.set_default_profile(profile_id, user_id)

        if not success:
            raise HTTPException(status_code=404, detail="Profile not found")

        return {"success": True, "message": "Default profile updated"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to set default profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/credential-profiles/{profile_id}/set-dashboard-default")
async def set_dashboard_default_profile(
    profile_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Set a profile as default for dashboard MCP access."""
    try:
        db = get_db()
        service = ProfileService(db)
        success = await service.set_dashboard_default_profile(profile_id, user_id)

        if not success:
            raise HTTPException(status_code=404, detail="Profile not found")

        return {"success": True, "message": "Dashboard default profile updated"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to set dashboard default profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/credential-profiles/{profile_id}/toggle-active")
async def toggle_profile_active(
    profile_id: str,
    is_active: bool = Query(..., description="New active status"),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Toggle a profile's active status."""
    try:
        db = get_db()
        service = ProfileService(db)

        request = UpdateProfileRequest(is_active=is_active)
        updated = await service.update_profile(profile_id, user_id, request)

        if not updated:
            raise HTTPException(status_code=404, detail="Profile not found")

        return {
            "success": True,
            "profile_id": profile_id,
            "is_active": updated.is_active
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to toggle profile active status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Dashboard MCP Access Endpoints
# ============================================================================

@router.get("/dashboard-profiles")
async def get_dashboard_profiles(
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """
    Get profiles marked as default for dashboard access.

    These are the profiles that will be automatically connected
    when using the AI agent in the dashboard.
    """
    try:
        db = get_db()
        service = ProfileService(db)
        profiles = await service.list_profiles(user_id, active_only=True)

        # Filter to only dashboard defaults
        dashboard_profiles = [
            p for p in profiles
            if p.is_default_for_dashboard
        ]

        return {
            "success": True,
            "profiles": [p.model_dump() for p in dashboard_profiles],
            "count": len(dashboard_profiles)
        }

    except Exception as e:
        logger.error(f"Failed to get dashboard profiles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dashboard-mcp-urls")
async def get_dashboard_mcp_urls(
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """
    Get MCP URLs for all dashboard-enabled profiles.

    Used to automatically connect integrations when starting an AI session.
    """
    try:
        db = get_db()
        profile_service = ProfileService(db)
        mcp_service = MCPServerService()

        profiles = await profile_service.list_profiles(user_id, active_only=True)
        dashboard_profiles = [p for p in profiles if p.is_default_for_dashboard]

        mcp_configs = []
        for profile in dashboard_profiles:
            try:
                mcp_url = await mcp_service.generate_mcp_url(
                    profile.connected_account_id,
                    user_id
                )
                mcp_configs.append({
                    "profile_id": profile.profile_id,
                    "profile_name": profile.profile_name,
                    "toolkit_slug": profile.toolkit_slug,
                    "mcp_url": mcp_url,
                    "enabled_tools": profile.enabled_tools
                })
            except Exception as e:
                logger.warning(f"Failed to get MCP URL for profile {profile.profile_id}: {e}")

        return {
            "success": True,
            "mcp_configs": mcp_configs,
            "count": len(mcp_configs)
        }

    except Exception as e:
        logger.error(f"Failed to get dashboard MCP URLs: {e}")
        raise HTTPException(status_code=500, detail=str(e))
