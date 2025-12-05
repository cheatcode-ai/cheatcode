"""
Connected Account Service for Composio.
Handles OAuth flow initiation, connection management, and status tracking.
Uses REST API v3 for compatibility with latest SDK changes (2025).
"""

import httpx
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from datetime import datetime
from utils.logger import logger
from composio_integration.client import get_composio_api_key, COMPOSIO_API_V3


def _get_headers() -> Dict[str, str]:
    """Get headers for Composio API requests."""
    return {
        "X-API-Key": get_composio_api_key(),
        "Content-Type": "application/json"
    }


class ConnectionRequest(BaseModel):
    """Response from initiating an OAuth connection."""
    id: str
    redirect_url: str
    status: str = "INITIATED"
    expires_at: Optional[str] = None


class ConnectedAccount(BaseModel):
    """Represents a connected third-party account."""
    id: str
    entity_id: str  # Our user_id
    app_name: str
    status: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    # Additional metadata
    integration_id: Optional[str] = None
    connection_params: Dict[str, Any] = Field(default_factory=dict)


class ConnectionStatus(BaseModel):
    """Status of a connection request."""
    id: str
    status: str
    connected_account_id: Optional[str] = None
    error: Optional[str] = None


class ConnectedAccountService:
    """Service for managing Composio connected accounts (OAuth connections)."""

    async def _get_or_create_auth_config_for_toolkit(
        self,
        toolkit_slug: str
    ) -> Optional[str]:
        """
        Get or create an auth config ID for a toolkit.

        First tries to get existing auth configs, if that fails (403 or empty),
        creates a new one using POST /api/v3/auth_configs.

        Args:
            toolkit_slug: The toolkit slug (e.g., 'github', 'slack')

        Returns:
            The auth_config_id or None if not found/created
        """
        toolkit_lower = toolkit_slug.lower()

        # Method 1: Try to get existing auth configs
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{COMPOSIO_API_V3}/auth_configs",
                    headers=_get_headers(),
                    params={
                        "toolkit_slug": toolkit_lower,
                        "is_composio_managed": "true",
                        "limit": 1
                    }
                )
                if response.status_code == 200:
                    data = response.json()
                    items = data.get('items', [])
                    if items and len(items) > 0:
                        auth_config_id = items[0].get('id')
                        logger.info(f"Found existing auth config {auth_config_id} for toolkit {toolkit_slug}")
                        return auth_config_id
        except Exception as e:
            logger.debug(f"Could not fetch existing auth configs: {e}")

        # Method 2: Create a new auth config for this toolkit
        try:
            logger.info(f"Creating new auth config for toolkit {toolkit_slug}")
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{COMPOSIO_API_V3}/auth_configs",
                    headers=_get_headers(),
                    json={
                        "toolkit": {
                            "slug": toolkit_lower
                        }
                    }
                )
                response.raise_for_status()
                data = response.json()

            # Extract auth_config.id from response
            auth_config = data.get('auth_config', data)
            auth_config_id = auth_config.get('id')

            if auth_config_id:
                logger.info(f"Created auth config {auth_config_id} for toolkit {toolkit_slug}")
                return auth_config_id

            logger.warning(f"Created auth config but no ID returned for toolkit {toolkit_slug}")
            return None

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error creating auth config for {toolkit_slug}: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            logger.error(f"Failed to create auth config for toolkit {toolkit_slug}: {e}")
            return None

    async def initiate_connection(
        self,
        user_id: str,
        app_name: str,
        redirect_url: Optional[str] = None,
        integration_id: Optional[str] = None,
        initiation_params: Optional[Dict[str, Any]] = None,
        auth_mode: Optional[str] = None,
        auth_config: Optional[Dict[str, Any]] = None,
        auth_config_id: Optional[str] = None
    ) -> ConnectionRequest:
        """
        Initiate an OAuth connection flow for a user using v3 API.

        Args:
            user_id: The Cheatcode user ID (Clerk ID)
            app_name: The Composio app key/slug (e.g., 'github', 'slack')
            redirect_url: URL to redirect after OAuth completion
            integration_id: Optional custom integration ID (deprecated, use auth_config_id)
            initiation_params: Additional parameters for OAuth initiation
            auth_mode: Auth mode (e.g., 'OAUTH2', 'API_KEY')
            auth_config: Custom auth configuration for bring-your-own-OAuth
            auth_config_id: The auth config ID to use (if not provided, fetches default)

        Returns:
            ConnectionRequest with redirect URL for OAuth flow

        Raises:
            Exception: If connection initiation fails
        """
        try:
            # Get auth_config_id if not provided
            config_id = auth_config_id or integration_id
            if not config_id:
                config_id = await self._get_or_create_auth_config_for_toolkit(app_name)
                if not config_id:
                    raise ValueError(f"Could not get or create auth config for toolkit {app_name}")

            logger.info(f"Initiating v3 connection for user {user_id} to app {app_name} with auth_config {config_id}")

            # Build v3 API request payload
            # The v3 API requires: auth_config.id, connection object, and user_id
            payload: Dict[str, Any] = {
                "auth_config": {
                    "id": config_id
                },
                "connection": {},  # Required empty object for OAuth2 flows
                "user_id": user_id
            }

            if redirect_url:
                payload["redirect_url"] = redirect_url

            # Add any additional connection params if provided
            if initiation_params:
                payload["connection"] = initiation_params

            # Use v3 REST API to initiate connection
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{COMPOSIO_API_V3}/connected_accounts",
                    headers=_get_headers(),
                    json=payload
                )
                response.raise_for_status()
                data = response.json()

            # Extract response fields from v3 response
            connection = data.get('connection', data)
            connection_id = (
                connection.get('id') or
                data.get('connectionId') or
                data.get('connection_id') or
                ""
            )

            # v3 returns redirect info in different places
            redirect = (
                connection.get('redirectUrl') or
                connection.get('redirect_url') or
                data.get('redirectUrl') or
                data.get('redirect_url') or
                data.get('redirect_uri') or
                connection.get('data', {}).get('redirectUrl') or
                connection.get('data', {}).get('authUri') or
                ""
            )

            status = connection.get('state', connection.get('status', 'INITIATED'))
            if isinstance(status, dict):
                status = status.get('status', 'INITIATED')

            logger.info(f"Connection initiated: {connection_id}, redirect: {redirect[:50] if redirect else 'N/A'}...")

            return ConnectionRequest(
                id=str(connection_id),
                redirect_url=redirect,
                status=str(status).upper() if status else "INITIATED",
                expires_at=None
            )

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error initiating connection: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Failed to initiate connection for user {user_id} to {app_name}: {e}")
            raise

    async def get_connection(self, connection_id: str) -> Optional[ConnectedAccount]:
        """
        Get a connected account by ID using v3 API.

        Args:
            connection_id: The Composio connection ID (nanoid in v3)

        Returns:
            ConnectedAccount if found, None otherwise
        """
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{COMPOSIO_API_V3}/connected_accounts/{connection_id}",
                    headers=_get_headers()
                )

                if response.status_code == 404:
                    return None

                response.raise_for_status()
                data = response.json()

            return self._convert_dict_to_connected_account(data)

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            logger.error(f"HTTP error getting connection {connection_id}: {e.response.status_code}")
            return None
        except Exception as e:
            logger.error(f"Failed to get connection {connection_id}: {e}")
            return None

    async def get_connection_status(self, connection_id: str) -> ConnectionStatus:
        """
        Check the status of a connection request using v3 API.

        Args:
            connection_id: The connection request ID

        Returns:
            ConnectionStatus with current status
        """
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{COMPOSIO_API_V3}/connected_accounts/{connection_id}",
                    headers=_get_headers()
                )
                response.raise_for_status()
                data = response.json()

            # v3 API returns status in different formats
            status = data.get('status', data.get('state', 'UNKNOWN'))
            if isinstance(status, dict):
                status = status.get('status', 'UNKNOWN')
            connected_id = data.get('id') if str(status).upper() == 'ACTIVE' else None

            return ConnectionStatus(
                id=connection_id,
                status=str(status).upper(),
                connected_account_id=str(connected_id) if connected_id else None
            )

        except Exception as e:
            logger.error(f"Failed to get connection status for {connection_id}: {e}")
            return ConnectionStatus(
                id=connection_id,
                status="ERROR",
                error=str(e)
            )

    async def list_connections(
        self,
        user_id: str,
        app_name: Optional[str] = None,
        status: Optional[str] = None
    ) -> List[ConnectedAccount]:
        """
        List all connected accounts for a user using v3 API.

        Args:
            user_id: The Cheatcode user ID
            app_name: Optional filter by app name (toolkit_slug in v3)
            status: Optional filter by status

        Returns:
            List of ConnectedAccount objects
        """
        try:
            # v3 API uses different parameter names
            params: Dict[str, str] = {"user_ids": user_id}
            if app_name:
                params["toolkit_slugs"] = app_name.lower()
            if status:
                params["statuses"] = status.upper()

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{COMPOSIO_API_V3}/connected_accounts",
                    headers=_get_headers(),
                    params=params
                )
                response.raise_for_status()
                data = response.json()

            # Handle different response formats
            accounts_data = []
            if isinstance(data, list):
                accounts_data = data
            elif isinstance(data, dict):
                accounts_data = data.get('items') or data.get('connectedAccounts') or data.get('data') or []

            result = []
            for acc_data in accounts_data:
                connected = self._convert_dict_to_connected_account(acc_data)
                if connected:
                    result.append(connected)

            return result

        except Exception as e:
            logger.error(f"Failed to list connections for user {user_id}: {e}")
            return []

    async def wait_for_connection(
        self,
        connection_id: str,
        timeout: int = 60
    ) -> ConnectedAccount:
        """
        Wait for an OAuth connection to complete.

        Args:
            connection_id: The connection request ID
            timeout: Max seconds to wait

        Returns:
            ConnectedAccount once OAuth completes

        Raises:
            TimeoutError: If connection doesn't complete in time
        """
        import asyncio

        try:
            start_time = asyncio.get_event_loop().time()
            poll_interval = 2  # seconds

            while True:
                elapsed = asyncio.get_event_loop().time() - start_time
                if elapsed >= timeout:
                    raise TimeoutError(f"Connection {connection_id} did not complete within {timeout}s")

                status = await self.get_connection_status(connection_id)

                if status.status == "ACTIVE":
                    account = await self.get_connection(connection_id)
                    if account:
                        return account
                    # If we got ACTIVE but couldn't fetch account, try once more
                    await asyncio.sleep(1)
                    account = await self.get_connection(connection_id)
                    if account:
                        return account
                    raise Exception("Connection active but account not found")

                if status.status == "ERROR":
                    raise Exception(f"Connection failed: {status.error}")

                if status.status in ["EXPIRED", "REVOKED", "FAILED"]:
                    raise Exception(f"Connection {status.status.lower()}")

                await asyncio.sleep(poll_interval)

        except TimeoutError:
            raise
        except Exception as e:
            logger.error(f"Failed waiting for connection {connection_id}: {e}")
            raise

    async def delete_connection(self, connection_id: str) -> bool:
        """
        Delete/disconnect a connected account using v3 API.

        Args:
            connection_id: The connected account ID

        Returns:
            True if deletion succeeded
        """
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.delete(
                    f"{COMPOSIO_API_V3}/connected_accounts/{connection_id}",
                    headers=_get_headers()
                )

                # 204 No Content or 200 OK both mean success
                if response.status_code in [200, 204, 404]:
                    logger.info(f"Deleted connection {connection_id}")
                    return True

                response.raise_for_status()
                return True

        except Exception as e:
            logger.error(f"Failed to delete connection {connection_id}: {e}")
            return False

    async def refresh_connection(self, connection_id: str) -> Optional[ConnectedAccount]:
        """
        Refresh OAuth tokens for a connection using v3 API.

        Args:
            connection_id: The connected account ID (nanoid in v3)

        Returns:
            Updated ConnectedAccount if successful
        """
        try:
            # v3 API uses /connected_accounts/{nanoid}/refresh
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{COMPOSIO_API_V3}/connected_accounts/{connection_id}/refresh",
                    headers=_get_headers()
                )

                if response.status_code == 200:
                    data = response.json()
                    return self._convert_dict_to_connected_account(data)
                elif response.status_code == 404:
                    # Endpoint might not exist, just return current state
                    pass

            # Fallback: just get the current state
            return await self.get_connection(connection_id)

        except Exception as e:
            logger.error(f"Failed to refresh connection {connection_id}: {e}")
            return None

    async def get_user_connections_by_app(
        self,
        user_id: str
    ) -> Dict[str, List[ConnectedAccount]]:
        """
        Get all user connections grouped by app.

        Args:
            user_id: The Cheatcode user ID

        Returns:
            Dict mapping app_name to list of connections
        """
        connections = await self.list_connections(user_id)

        grouped: Dict[str, List[ConnectedAccount]] = {}
        for conn in connections:
            if conn.app_name not in grouped:
                grouped[conn.app_name] = []
            grouped[conn.app_name].append(conn)

        return grouped

    def _convert_dict_to_connected_account(self, data: Dict[str, Any]) -> Optional[ConnectedAccount]:
        """Convert REST API v3 response dict to ConnectedAccount model."""
        try:
            account_id = str(data.get('id', ''))

            # v3 uses user_id, v1 used entityId
            entity_id = str(
                data.get('user_id') or
                data.get('entityId') or
                data.get('entity_id') or
                ''
            )

            # v3 uses toolkit object with slug, v1 used appName
            toolkit = data.get('toolkit', {})
            app_name = (
                toolkit.get('slug') if isinstance(toolkit, dict) else None
            ) or (
                data.get('appName') or
                data.get('app_name') or
                data.get('app') or
                ''
            )

            # v3 status may be in different places
            status = data.get('status', data.get('state', 'UNKNOWN'))
            if isinstance(status, dict):
                status = status.get('status', 'UNKNOWN')

            created = data.get('createdAt') or data.get('created_at')
            updated = data.get('updatedAt') or data.get('updated_at') or data.get('last_updated_at')

            # Get additional params (v3 uses 'data' or 'val' instead of connectionParams)
            connection_params = (
                data.get('connectionParams') or
                data.get('connection_params') or
                data.get('data') or
                data.get('val') or
                {}
            )

            return ConnectedAccount(
                id=account_id,
                entity_id=entity_id,
                app_name=str(app_name).upper() if app_name else '',
                status=str(status).upper() if status else 'UNKNOWN',
                created_at=str(created) if created else None,
                updated_at=str(updated) if updated else None,
                connection_params=connection_params if isinstance(connection_params, dict) else {}
            )

        except Exception as e:
            logger.warning(f"Failed to convert account dict: {e}")
            return None
