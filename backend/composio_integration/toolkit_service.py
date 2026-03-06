"""Toolkit discovery and management service for Composio.

Handles listing, filtering, and retrieving toolkit/app information.
Uses Composio REST API for compatibility with SDK changes.
"""

from typing import Any

import httpx
from pydantic import BaseModel, Field

from composio_integration.client import COMPOSIO_API_V3, get_composio_api_key
from utils.logger import logger


def _get_headers() -> dict[str, str]:
    """Get headers for Composio API requests."""
    return {"X-API-Key": get_composio_api_key(), "Content-Type": "application/json"}


class InitiationField(BaseModel):
    """Field required to initiate OAuth connection."""

    name: str
    display_name: str = ""
    description: str | None = None
    type: str = "string"
    required: bool = False
    default_value: Any | None = None


class AuthConfigDetails(BaseModel):
    """OAuth configuration details for custom auth."""

    client_id: str | None = None
    client_secret: str | None = None
    scopes: list[str] = Field(default_factory=list)


class ToolkitInfo(BaseModel):
    """Information about a Composio toolkit/app."""

    slug: str
    name: str
    description: str | None = None
    icon_url: str | None = None  # Icon/logo URL from Composio
    categories: list[str] = Field(default_factory=list)
    auth_schemes: list[str] = Field(default_factory=list)
    connected_account_initiation_fields: list[InitiationField] = Field(default_factory=list)
    auth_config_details: AuthConfigDetails | None = None
    enabled: bool = True


class ToolkitListResponse(BaseModel):
    """Response for listing toolkits."""

    toolkits: list[ToolkitInfo]
    next_cursor: str | None = None
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

    # Featured/popular apps to show first (in order of priority)
    FEATURED_APPS = [
        "github",
        "slack",
        "gmail",
        "notion",
        "linear",
        "google_sheets",
        "google_drive",
        "google_calendar",
        "jira",
        "discord",
        "asana",
        "trello",
        "airtable",
        "hubspot",
        "salesforce",
        "stripe",
        "twitter",
        "figma",
        "dropbox",
        "zoom",
    ]

    def __init__(self):
        self._toolkits_cache: list[ToolkitInfo] | None = None
        self._cache_timestamp: float = 0

    async def list_categories(self) -> list[str]:
        """List available toolkit categories."""
        return self.CATEGORIES

    def _convert_app_dict_to_toolkit_info(self, app: dict[str, Any]) -> ToolkitInfo | None:
        """Convert a Composio app dict (from REST API) to ToolkitInfo."""
        try:
            # Handle REST API response format (dict)
            slug = (
                app.get("key") or app.get("slug") or app.get("appId") or app.get("name", "").lower().replace(" ", "_")
            )
            name = app.get("name", slug)

            # Get meta object for nested fields
            meta = app.get("meta", {}) or {}
            description = app.get("description", "") or meta.get("description", "")
            logo = meta.get("logo") or app.get("logo") or app.get("logo_url") or app.get("logoUrl")

            # Get auth schemes
            auth_schemes = []
            if "auth_schemes" in app:
                auth_schemes = app["auth_schemes"] if isinstance(app["auth_schemes"], list) else [app["auth_schemes"]]
            elif "authSchemes" in app:
                auth_schemes = app["authSchemes"] if isinstance(app["authSchemes"], list) else [app["authSchemes"]]
            elif "authentication" in app:
                # Some responses have authentication info in different format
                auth_info = app["authentication"]
                if isinstance(auth_info, list):
                    auth_schemes = [a.get("type", "") for a in auth_info if isinstance(a, dict)]
                elif isinstance(auth_info, dict):
                    auth_schemes = [auth_info.get("type", "")]

            # Get categories (can be in meta.categories or app.categories)
            categories = []
            raw_categories = meta.get("categories") or app.get("categories") or []
            if isinstance(raw_categories, list):
                for cat in raw_categories:
                    if isinstance(cat, dict):
                        categories.append(cat.get("name", ""))
                    elif isinstance(cat, str):
                        categories.append(cat)

            # Get initiation fields for OAuth
            test_connectors = app.get("testConnectors") or app.get("test_connectors") or []
            initiation_fields = [
                InitiationField(
                    name=field.get("name", ""),
                    display_name=field.get("displayName", field.get("display_name", field.get("name", ""))),
                    description=field.get("description"),
                    type=field.get("type", "string"),
                    required=field.get("required", False),
                    default_value=field.get("defaultValue", field.get("default_value")),
                )
                for field in test_connectors
                if isinstance(field, dict)
            ]

            return ToolkitInfo(
                slug=slug,
                name=name,
                description=description,
                icon_url=logo,
                categories=categories,
                auth_schemes=auth_schemes,
                connected_account_initiation_fields=initiation_fields,
                enabled=True,
            )
        except Exception as e:
            logger.warning(f"Failed to convert app to toolkit info: {e}")
            return None

    async def _fetch_apps_from_api(self) -> list[dict[str, Any]]:
        """Fetch apps list from Composio REST API."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{COMPOSIO_API_V3}/toolkits", headers=_get_headers())
                response.raise_for_status()
                data = response.json()

                # Handle different response formats
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    return data.get("items") or data.get("apps") or data.get("data") or []
                return []
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error fetching apps: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Error fetching apps from Composio API: {e}")
            raise

    async def list_toolkits(
        self,
        category: str | None = None,
        search: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
        auth_scheme_filter: list[str] | None = None,
    ) -> ToolkitListResponse:
        """List available toolkits with optional filtering.

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
            toolkits: list[ToolkitInfo] = []
            for app in apps:
                toolkit = self._convert_app_dict_to_toolkit_info(app)
                if toolkit:
                    # Include all toolkits by default, only filter if auth_scheme_filter is specified
                    if auth_scheme_filter is None:
                        # Include all toolkits
                        toolkits.append(toolkit)
                    # Apply custom auth scheme filter
                    elif any(
                        scheme.upper() in [f.upper() for f in auth_scheme_filter] for scheme in toolkit.auth_schemes
                    ):
                        toolkits.append(toolkit)

            # Apply search filter
            if search:
                search_lower = search.lower()
                toolkits = [
                    t
                    for t in toolkits
                    if search_lower in t.name.lower()
                    or search_lower in (t.description or "").lower()
                    or search_lower in t.slug.lower()
                ]

            # Apply category filter
            if category:
                category_lower = category.lower()
                toolkits = [t for t in toolkits if any(category_lower in c.lower() for c in t.categories)]

            # Sort: featured apps first (in order), then alphabetically
            def sort_key(t: ToolkitInfo) -> tuple:
                slug_lower = t.slug.lower()
                # Check if it's a featured app
                if slug_lower in self.FEATURED_APPS:
                    # Featured apps get priority (0) and their index determines order
                    return (0, self.FEATURED_APPS.index(slug_lower), t.name.lower())
                # Non-featured apps come after (1) and are sorted alphabetically
                return (1, 0, t.name.lower())

            # Only apply featured sorting when not searching
            if search:
                toolkits.sort(key=lambda t: t.name.lower())
            else:
                toolkits.sort(key=sort_key)

            # Apply pagination
            start_idx = 0
            if cursor:
                try:
                    start_idx = int(cursor)
                except ValueError:
                    start_idx = 0

            total = len(toolkits)
            paginated = toolkits[start_idx : start_idx + limit]
            next_cursor = str(start_idx + limit) if start_idx + limit < total else None

            return ToolkitListResponse(toolkits=paginated, next_cursor=next_cursor, total=total)

        except Exception as e:
            logger.error(f"Failed to list toolkits: {e}")
            raise

    async def get_toolkit_details(self, slug: str) -> ToolkitInfo | None:
        """Get detailed information about a specific toolkit.

        Args:
            slug: The toolkit slug/key

        Returns:
            ToolkitInfo if found, None otherwise

        """
        try:
            # Try to get specific app by slug from REST API
            async with httpx.AsyncClient(timeout=30.0) as client:
                try:
                    response = await client.get(f"{COMPOSIO_API_V3}/toolkits/{slug}", headers=_get_headers())
                    if response.status_code == 200:
                        app_data = response.json()
                        return self._convert_app_dict_to_toolkit_info(app_data)
                except httpx.HTTPStatusError:
                    pass

            # Fallback: search through all apps
            apps = await self._fetch_apps_from_api()
            for app in apps:
                app_slug = (
                    app.get("key")
                    or app.get("slug")
                    or app.get("appId")
                    or app.get("name", "").lower().replace(" ", "_")
                )
                if app_slug.lower() == slug.lower():
                    return self._convert_app_dict_to_toolkit_info(app)

            logger.warning(f"Toolkit not found: {slug}")
            return None

        except Exception as e:
            logger.error(f"Failed to get toolkit {slug}: {e}")
            return None

    async def get_toolkit_icon(self, slug: str) -> str | None:
        """Get the icon URL for a toolkit.

        Args:
            slug: The toolkit slug/key

        Returns:
            Icon URL if available, None otherwise

        """
        toolkit = await self.get_toolkit_details(slug)
        return toolkit.icon_url if toolkit else None

    async def get_toolkit_auth_schemes(self, slug: str) -> list[str]:
        """Get available auth schemes for a toolkit.

        Args:
            slug: The toolkit slug/key

        Returns:
            List of auth scheme names

        """
        toolkit = await self.get_toolkit_details(slug)
        return toolkit.auth_schemes if toolkit else []

    async def get_toolkit_initiation_fields(self, slug: str) -> list[InitiationField]:
        """Get OAuth initiation fields for a toolkit.

        Args:
            slug: The toolkit slug/key

        Returns:
            List of initiation fields

        """
        toolkit = await self.get_toolkit_details(slug)
        return toolkit.connected_account_initiation_fields if toolkit else []

    async def search_toolkits(self, query: str, limit: int = 20) -> list[ToolkitInfo]:
        """Search toolkits by name or description.

        Args:
            query: Search query
            limit: Max results

        Returns:
            List of matching toolkits

        """
        result = await self.list_toolkits(search=query, limit=limit)
        return result.toolkits
