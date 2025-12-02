"""
Toolkit discovery and management service for Composio.
Handles listing, filtering, and retrieving toolkit/app information.
Uses Composio REST API for compatibility with SDK changes.
"""

import os
import httpx
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from utils.logger import logger

# Composio API base URLs - v3 is the current version
COMPOSIO_API_V3 = "https://backend.composio.dev/api/v3"


def _get_api_key() -> str:
    """Get Composio API key from environment."""
    api_key = os.getenv("COMPOSIO_API_KEY")
    if not api_key:
        raise ValueError("COMPOSIO_API_KEY environment variable is required")
    return api_key


def _get_headers() -> Dict[str, str]:
    """Get headers for Composio API requests."""
    return {
        "X-API-Key": _get_api_key(),
        "Content-Type": "application/json"
    }


class InitiationField(BaseModel):
    """Field required to initiate OAuth connection."""
    name: str
    display_name: str = ""
    description: Optional[str] = None
    type: str = "string"
    required: bool = False
    default_value: Optional[Any] = None


class AuthConfigDetails(BaseModel):
    """OAuth configuration details for custom auth."""
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)


class ToolkitInfo(BaseModel):
    """Information about a Composio toolkit/app."""
    slug: str
    name: str
    description: Optional[str] = None
    logo_url: Optional[str] = None
    categories: List[str] = Field(default_factory=list)
    auth_schemes: List[str] = Field(default_factory=list)
    connected_account_initiation_fields: List[InitiationField] = Field(default_factory=list)
    auth_config_details: Optional[AuthConfigDetails] = None
    enabled: bool = True


class ToolkitListResponse(BaseModel):
    """Response for listing toolkits."""
    toolkits: List[ToolkitInfo]
    next_cursor: Optional[str] = None
    total: int


class ToolkitService:
    """Service for managing Composio toolkits/apps."""

    # Common categories for organizing toolkits
    CATEGORIES = [
        "Productivity",
        "CRM",
        "Marketing",
        "Communication",
        "Development",
        "Storage",
        "E-commerce",
        "Analytics",
        "Social Media",
        "Finance",
        "HR",
        "Support",
        "AI",
        "Database",
        "Calendar",
        "Email",
    ]

    def __init__(self):
        self._toolkits_cache: Optional[List[ToolkitInfo]] = None
        self._cache_timestamp: float = 0

    async def list_categories(self) -> List[str]:
        """List available toolkit categories."""
        return self.CATEGORIES

    def _convert_app_dict_to_toolkit_info(self, app: Dict[str, Any]) -> Optional[ToolkitInfo]:
        """Convert a Composio app dict (from REST API) to ToolkitInfo."""
        try:
            # Handle REST API response format (dict)
            slug = app.get('key') or app.get('slug') or app.get('appId') or app.get('name', '').lower().replace(' ', '_')
            name = app.get('name', slug)
            description = app.get('description', '')
            logo = app.get('logo') or app.get('logo_url') or app.get('logoUrl')

            # Get auth schemes
            auth_schemes = []
            if 'auth_schemes' in app:
                auth_schemes = app['auth_schemes'] if isinstance(app['auth_schemes'], list) else [app['auth_schemes']]
            elif 'authSchemes' in app:
                auth_schemes = app['authSchemes'] if isinstance(app['authSchemes'], list) else [app['authSchemes']]
            elif 'authentication' in app:
                # Some responses have authentication info in different format
                auth_info = app['authentication']
                if isinstance(auth_info, list):
                    auth_schemes = [a.get('type', '') for a in auth_info if isinstance(a, dict)]
                elif isinstance(auth_info, dict):
                    auth_schemes = [auth_info.get('type', '')]

            # Get categories
            categories = []
            if 'categories' in app:
                categories = app['categories'] if isinstance(app['categories'], list) else [app['categories']]

            # Get initiation fields for OAuth
            initiation_fields = []
            test_connectors = app.get('testConnectors') or app.get('test_connectors') or []
            if test_connectors:
                for field in test_connectors:
                    if isinstance(field, dict):
                        initiation_fields.append(InitiationField(
                            name=field.get('name', ''),
                            display_name=field.get('displayName', field.get('display_name', field.get('name', ''))),
                            description=field.get('description'),
                            type=field.get('type', 'string'),
                            required=field.get('required', False),
                            default_value=field.get('defaultValue', field.get('default_value'))
                        ))

            return ToolkitInfo(
                slug=slug,
                name=name,
                description=description,
                logo_url=logo,
                categories=categories,
                auth_schemes=auth_schemes,
                connected_account_initiation_fields=initiation_fields,
                enabled=True
            )
        except Exception as e:
            logger.warning(f"Failed to convert app to toolkit info: {e}")
            return None

    async def _fetch_apps_from_api(self) -> List[Dict[str, Any]]:
        """Fetch apps list from Composio REST API."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{COMPOSIO_API_V3}/toolkits",
                    headers=_get_headers()
                )
                response.raise_for_status()
                data = response.json()

                # Handle different response formats
                if isinstance(data, list):
                    return data
                elif isinstance(data, dict):
                    return data.get('items') or data.get('apps') or data.get('data') or []
                return []
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error fetching apps: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Error fetching apps from Composio API: {e}")
            raise

    async def list_toolkits(
        self,
        category: Optional[str] = None,
        search: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: int = 50,
        auth_scheme_filter: Optional[List[str]] = None
    ) -> ToolkitListResponse:
        """
        List available toolkits with optional filtering.

        Args:
            category: Filter by category
            search: Search term for name/description
            cursor: Pagination cursor (offset as string)
            limit: Max results per page (default 50, max 100)
            auth_scheme_filter: Filter by auth schemes (e.g., ['OAUTH2'])

        Returns:
            ToolkitListResponse with paginated results
        """
        try:
            # Get all apps from Composio REST API
            apps = await self._fetch_apps_from_api()
            logger.info(f"Retrieved {len(apps)} apps from Composio API")

            # Convert to ToolkitInfo objects
            toolkits: List[ToolkitInfo] = []
            for app in apps:
                toolkit = self._convert_app_dict_to_toolkit_info(app)
                if toolkit:
                    # Include all toolkits by default, only filter if auth_scheme_filter is specified
                    if auth_scheme_filter is None:
                        # Include all toolkits
                        toolkits.append(toolkit)
                    else:
                        # Apply custom auth scheme filter
                        if any(scheme.upper() in [f.upper() for f in auth_scheme_filter]
                               for scheme in toolkit.auth_schemes):
                            toolkits.append(toolkit)

            # Apply search filter
            if search:
                search_lower = search.lower()
                toolkits = [
                    t for t in toolkits
                    if search_lower in t.name.lower() or
                       search_lower in (t.description or "").lower() or
                       search_lower in t.slug.lower()
                ]

            # Apply category filter
            if category:
                category_lower = category.lower()
                toolkits = [
                    t for t in toolkits
                    if any(category_lower in c.lower() for c in t.categories)
                ]

            # Sort alphabetically by name
            toolkits.sort(key=lambda t: t.name.lower())

            # Apply pagination
            start_idx = 0
            if cursor:
                try:
                    start_idx = int(cursor)
                except ValueError:
                    start_idx = 0

            total = len(toolkits)
            paginated = toolkits[start_idx:start_idx + limit]
            next_cursor = str(start_idx + limit) if start_idx + limit < total else None

            return ToolkitListResponse(
                toolkits=paginated,
                next_cursor=next_cursor,
                total=total
            )

        except Exception as e:
            logger.error(f"Failed to list toolkits: {e}")
            raise

    async def get_toolkit_details(self, slug: str) -> Optional[ToolkitInfo]:
        """
        Get detailed information about a specific toolkit.

        Args:
            slug: The toolkit slug/key

        Returns:
            ToolkitInfo if found, None otherwise
        """
        try:
            # Try to get specific app by slug from REST API
            async with httpx.AsyncClient(timeout=30.0) as client:
                try:
                    response = await client.get(
                        f"{COMPOSIO_API_V3}/toolkits/{slug}",
                        headers=_get_headers()
                    )
                    if response.status_code == 200:
                        app_data = response.json()
                        return self._convert_app_dict_to_toolkit_info(app_data)
                except httpx.HTTPStatusError:
                    pass

            # Fallback: search through all apps
            apps = await self._fetch_apps_from_api()
            for app in apps:
                app_slug = app.get('key') or app.get('slug') or app.get('appId') or app.get('name', '').lower().replace(' ', '_')
                if app_slug.lower() == slug.lower():
                    return self._convert_app_dict_to_toolkit_info(app)

            logger.warning(f"Toolkit not found: {slug}")
            return None

        except Exception as e:
            logger.error(f"Failed to get toolkit {slug}: {e}")
            return None

    async def get_toolkit_icon(self, slug: str) -> Optional[str]:
        """
        Get the icon URL for a toolkit.

        Args:
            slug: The toolkit slug/key

        Returns:
            Icon URL if available, None otherwise
        """
        toolkit = await self.get_toolkit_details(slug)
        return toolkit.logo_url if toolkit else None

    async def get_toolkit_auth_schemes(self, slug: str) -> List[str]:
        """
        Get available auth schemes for a toolkit.

        Args:
            slug: The toolkit slug/key

        Returns:
            List of auth scheme names
        """
        toolkit = await self.get_toolkit_details(slug)
        return toolkit.auth_schemes if toolkit else []

    async def get_toolkit_initiation_fields(self, slug: str) -> List[InitiationField]:
        """
        Get OAuth initiation fields for a toolkit.

        Args:
            slug: The toolkit slug/key

        Returns:
            List of initiation fields
        """
        toolkit = await self.get_toolkit_details(slug)
        return toolkit.connected_account_initiation_fields if toolkit else []

    async def search_toolkits(
        self,
        query: str,
        limit: int = 20
    ) -> List[ToolkitInfo]:
        """
        Search toolkits by name or description.

        Args:
            query: Search query
            limit: Max results

        Returns:
            List of matching toolkits
        """
        result = await self.list_toolkits(search=query, limit=limit)
        return result.toolkits
