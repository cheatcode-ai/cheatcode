"""
Composio integration module for Cheatcode.
Provides third-party app integrations via Composio's REST API.
"""

from .client import (
    get_composio_client,
    get_composio_api_key,
    get_composio_headers,
    verify_composio_connection,
    reset_composio_client
)

__all__ = [
    "get_composio_client",
    "get_composio_api_key",
    "get_composio_headers",
    "verify_composio_connection",
    "reset_composio_client",
]
