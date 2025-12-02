"""
MCP (Model Context Protocol) API module

This module provides API endpoints for custom MCP server discovery.
MCP integrations are managed through Composio.
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from pydantic import BaseModel
from utils.logger import logger
from mcp_service.mcp_custom import discover_custom_tools

router = APIRouter()


class CustomMCPDiscoverRequest(BaseModel):
    """Request model for discovering custom MCP tools."""
    type: str
    config: Dict[str, Any]


@router.post("/mcp/discover-custom-tools")
async def discover_custom_mcp_tools(request: CustomMCPDiscoverRequest):
    """
    Discover tools from a custom MCP server.

    This endpoint allows discovering tools from custom MCP servers
    that aren't managed through Composio.
    """
    try:
        return await discover_custom_tools(request.type, request.config)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error discovering custom MCP tools: {e}")
        raise HTTPException(status_code=500, detail=str(e))
