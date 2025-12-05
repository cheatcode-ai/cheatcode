"""
Standardized HTTP error responses for the Cheatcode API.

This module provides a centralized, single source of truth for all HTTP error
responses used across the application. Using these helpers ensures consistent
error messages and reduces duplication.

Usage:
    from utils.errors import (
        unauthorized_error,
        user_not_found_error,
        thread_not_found_error,
        project_not_found_error,
    )

    # In an endpoint:
    raise user_not_found_error()
"""

from fastapi import HTTPException
from typing import Optional


# =============================================================================
# Authentication Errors (401)
# =============================================================================

def no_auth_credentials_error() -> HTTPException:
    """No valid authentication credentials found in request."""
    return HTTPException(
        status_code=401,
        detail="No valid authentication credentials found",
        headers={"WWW-Authenticate": "Bearer"}
    )


def invalid_token_error(reason: Optional[str] = None) -> HTTPException:
    """Invalid or malformed authentication token."""
    detail = f"Invalid token: {reason}" if reason else "Invalid token"
    return HTTPException(
        status_code=401,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"}
    )


def invalid_token_payload_error(reason: str = "missing user ID") -> HTTPException:
    """Token payload is invalid or missing required claims."""
    return HTTPException(
        status_code=401,
        detail=f"Invalid token payload: {reason}",
        headers={"WWW-Authenticate": "Bearer"}
    )


def authentication_required_error() -> HTTPException:
    """Authentication is required to access this resource."""
    return HTTPException(
        status_code=401,
        detail="Authentication required for this resource"
    )


def stream_auth_required_error() -> HTTPException:
    """Authentication required for streaming endpoints."""
    return HTTPException(
        status_code=401,
        detail="Authentication required - provide token via query parameter or Authorization header",
        headers={"WWW-Authenticate": "Bearer"}
    )


def admin_api_key_required_error() -> HTTPException:
    """Admin API key is required."""
    return HTTPException(
        status_code=401,
        detail="Admin API key required. Include X-Admin-Api-Key header."
    )


# =============================================================================
# Authorization Errors (403)
# =============================================================================

def not_authorized_error(resource: str = "resource") -> HTTPException:
    """User is not authorized to access this resource."""
    return HTTPException(
        status_code=403,
        detail=f"Not authorized to access this {resource}"
    )


def user_account_not_found_error() -> HTTPException:
    """User account not found (for authorization checks)."""
    return HTTPException(
        status_code=403,
        detail="User account not found"
    )


def invalid_admin_api_key_error() -> HTTPException:
    """Invalid admin API key."""
    return HTTPException(
        status_code=403,
        detail="Invalid admin API key"
    )


# =============================================================================
# Not Found Errors (404)
# =============================================================================

def thread_not_found_error() -> HTTPException:
    """Thread not found."""
    return HTTPException(
        status_code=404,
        detail="Thread not found"
    )


def project_not_found_error() -> HTTPException:
    """Project not found."""
    return HTTPException(
        status_code=404,
        detail="Project not found"
    )


def sandbox_not_found_error() -> HTTPException:
    """Sandbox not found."""
    return HTTPException(
        status_code=404,
        detail="Sandbox not found"
    )


def resource_not_found_error(resource: str) -> HTTPException:
    """Generic resource not found."""
    return HTTPException(
        status_code=404,
        detail=f"{resource} not found"
    )


# =============================================================================
# Bad Request Errors (400)
# =============================================================================

def user_account_missing_error() -> HTTPException:
    """User account not found (for creation/update operations)."""
    return HTTPException(
        status_code=400,
        detail="User account not found"
    )


def missing_required_field_error(field: str) -> HTTPException:
    """Required field is missing."""
    return HTTPException(
        status_code=400,
        detail=f"{field} is required"
    )


def invalid_request_error(reason: str) -> HTTPException:
    """Invalid request with custom reason."""
    return HTTPException(
        status_code=400,
        detail=reason
    )


# =============================================================================
# Server Errors (500)
# =============================================================================

def internal_auth_error() -> HTTPException:
    """Internal authentication error."""
    return HTTPException(
        status_code=500,
        detail="Internal authentication error",
        headers={"WWW-Authenticate": "Bearer"}
    )


def internal_error(operation: str = "operation") -> HTTPException:
    """Generic internal server error."""
    return HTTPException(
        status_code=500,
        detail=f"Failed to {operation}"
    )


def admin_api_key_not_configured_error() -> HTTPException:
    """Admin API key not configured on server."""
    return HTTPException(
        status_code=500,
        detail="Admin API key not configured on server"
    )


def thread_no_user_error() -> HTTPException:
    """Thread has no associated user."""
    return HTTPException(
        status_code=500,
        detail="Thread has no associated user"
    )


def creation_failed_error(resource: str) -> HTTPException:
    """Resource creation returned no data."""
    return HTTPException(
        status_code=500,
        detail=f"{resource} creation returned no data"
    )


# =============================================================================
# Service Unavailable Errors (503)
# =============================================================================

def server_shutting_down_error() -> HTTPException:
    """Server is shutting down."""
    return HTTPException(
        status_code=503,
        detail="Server is shutting down"
    )


# =============================================================================
# Billing/Quota Errors
# =============================================================================

def insufficient_credits_error(required: int = 0, available: int = 0) -> HTTPException:
    """User doesn't have enough credits."""
    detail = "Insufficient credits"
    if required > 0:
        detail = f"Insufficient credits. Required: {required}, Available: {available}"
    return HTTPException(
        status_code=402,
        detail=detail
    )


def quota_exceeded_error() -> HTTPException:
    """User has exceeded their quota."""
    return HTTPException(
        status_code=429,
        detail="Quota exceeded. Please upgrade your plan or wait for quota reset."
    )
