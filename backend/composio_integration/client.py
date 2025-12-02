"""
Composio API client utilities for Cheatcode.
Provides helper functions for Composio REST API access.

Note: We primarily use REST API instead of SDK for better compatibility
with API changes and more predictable behavior.
"""

import os
import httpx
from typing import Optional, Dict, Any
from utils.logger import logger


# Composio API base URLs - v3 is the current version
COMPOSIO_API_V3 = "https://backend.composio.dev/api/v3"


def get_composio_api_key() -> str:
    """
    Get the Composio API key from environment.

    Returns:
        The API key string

    Raises:
        ValueError: If COMPOSIO_API_KEY is not set
    """
    api_key = os.getenv("COMPOSIO_API_KEY")
    if not api_key:
        raise ValueError(
            "COMPOSIO_API_KEY environment variable is required. "
            "Get your API key from https://app.composio.dev"
        )
    return api_key


def get_composio_headers() -> Dict[str, str]:
    """
    Get headers for Composio API requests.

    Returns:
        Dict with required headers
    """
    return {
        "X-API-Key": get_composio_api_key(),
        "Content-Type": "application/json"
    }


async def verify_composio_connection() -> dict:
    """
    Verify the Composio API connection is working.

    Returns:
        dict with status information
    """
    try:
        api_key = get_composio_api_key()

        # Make a simple API call to verify the key works (using v3 toolkits endpoint)
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{COMPOSIO_API_V3}/toolkits",
                headers={
                    "x-api-key": api_key,
                    "Content-Type": "application/json"
                },
                params={"limit": 1}  # Just get 1 toolkit to verify
            )

            if response.status_code == 200:
                return {
                    "status": "healthy",
                    "connected": True,
                    "api_key_configured": True
                }
            elif response.status_code == 401:
                return {
                    "status": "error",
                    "connected": False,
                    "error": "Invalid API key",
                    "api_key_configured": True
                }
            else:
                return {
                    "status": "error",
                    "connected": False,
                    "error": f"API returned status {response.status_code}",
                    "api_key_configured": True
                }

    except ValueError as e:
        return {
            "status": "error",
            "connected": False,
            "error": str(e),
            "api_key_configured": False
        }
    except httpx.TimeoutException:
        return {
            "status": "error",
            "connected": False,
            "error": "Connection timeout",
            "api_key_configured": True
        }
    except Exception as e:
        logger.error(f"Composio connection verification failed: {e}")
        return {
            "status": "error",
            "connected": False,
            "error": str(e),
            "api_key_configured": True
        }


# Legacy compatibility - SDK client wrapper
# Note: We prefer REST API, but keep SDK available for specific use cases
_composio_client = None


def get_composio_client():
    """
    Get Composio SDK client (lazy initialization).

    Note: Prefer using REST API methods in the service classes.
    This is kept for backward compatibility.

    Returns:
        Composio client instance

    Raises:
        ValueError: If COMPOSIO_API_KEY is not set
        ImportError: If composio package is not installed
    """
    global _composio_client

    if _composio_client is None:
        api_key = get_composio_api_key()

        try:
            from composio import Composio
            _composio_client = Composio(api_key=api_key)
            logger.info("Composio SDK client initialized")
        except ImportError as e:
            logger.warning(f"Composio SDK not available: {e}")
            raise ImportError(
                "composio package not installed. Install with: uv add composio"
            ) from e

    return _composio_client


def reset_composio_client():
    """Reset the SDK client singleton. Useful for testing or key rotation."""
    global _composio_client
    _composio_client = None
    logger.info("Composio SDK client reset")
