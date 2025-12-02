"""
Profile Service for Composio.
Manages credential profiles with encrypted storage in the database.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
import json
import hashlib

from utils.logger import logger
from services.supabase import DBConnection
from utils.encryption import encrypt_data, decrypt_data


class ComposioProfile(BaseModel):
    """Represents a Composio credential profile stored in the database."""
    profile_id: str
    user_id: str  # Clerk user ID
    toolkit_slug: str  # e.g., 'github', 'slack'
    profile_name: str  # User-defined name for this profile
    display_name: str  # Friendly display name
    connected_account_id: str  # Composio connected account ID
    mcp_qualified_name: str = ""  # Full MCP qualified name (e.g., "composio:github")
    is_active: bool = True
    is_default: bool = False
    is_default_for_dashboard: bool = False
    is_connected: bool = True  # Mirrors is_active - Composio manages actual connection state
    enabled_tools: List[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    last_used_at: Optional[str] = None


class CreateProfileRequest(BaseModel):
    """Request to create a new profile."""
    toolkit_slug: str
    profile_name: str
    display_name: Optional[str] = None
    connected_account_id: str
    enabled_tools: List[str] = Field(default_factory=list)
    is_default: bool = False
    is_default_for_dashboard: bool = False


class UpdateProfileRequest(BaseModel):
    """Request to update a profile."""
    profile_name: Optional[str] = None
    display_name: Optional[str] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    is_default_for_dashboard: Optional[bool] = None
    enabled_tools: Optional[List[str]] = None


class ProfileService:
    """Service for managing Composio credential profiles in the database."""

    TABLE_NAME = "user_mcp_credential_profiles"
    PROVIDER_PREFIX = "composio"  # Used in mcp_qualified_name: "composio:github"

    def __init__(self, db: DBConnection):
        self.db = db

    def _get_mcp_qualified_name(self, toolkit_slug: str) -> str:
        """Generate MCP qualified name from toolkit slug."""
        return f"{self.PROVIDER_PREFIX}:{toolkit_slug}"

    def _create_encrypted_config(
        self,
        connected_account_id: str,
        enabled_tools: List[str],
        additional_data: Dict[str, Any] = None
    ) -> tuple[str, str]:
        """
        Create encrypted config and its hash.

        Args:
            connected_account_id: The Composio connected account ID
            enabled_tools: List of enabled tool names
            additional_data: Any extra data to store

        Returns:
            Tuple of (encrypted_config, config_hash)
        """
        config = {
            "connected_account_id": connected_account_id,
            "enabled_tools": enabled_tools,
            "provider": self.PROVIDER_PREFIX
        }

        if additional_data:
            config.update(additional_data)

        config_json = json.dumps(config, sort_keys=True)
        encrypted_config = encrypt_data(config_json)
        config_hash = hashlib.sha256(config_json.encode()).hexdigest()

        return encrypted_config, config_hash

    def _decrypt_config(self, encrypted_config: str) -> Dict[str, Any]:
        """Decrypt profile config."""
        try:
            config_json = decrypt_data(encrypted_config)
            return json.loads(config_json)
        except Exception as e:
            logger.error(f"Failed to decrypt config: {e}")
            return {}

    def _db_row_to_profile(self, row: Dict[str, Any]) -> ComposioProfile:
        """Convert database row to ComposioProfile object."""
        # Decrypt config to get connection details
        decrypted = self._decrypt_config(row.get("encrypted_config", ""))

        # Extract toolkit slug from mcp_qualified_name
        mcp_name = row.get("mcp_qualified_name", "")
        toolkit_slug = mcp_name.replace(f"{self.PROVIDER_PREFIX}:", "")

        connected_account_id = decrypted.get("connected_account_id", "")
        is_active = row.get("is_active", True)

        return ComposioProfile(
            profile_id=str(row.get("profile_id", "")),
            user_id=row.get("user_id", ""),
            toolkit_slug=toolkit_slug,
            profile_name=row.get("profile_name", ""),
            display_name=row.get("display_name", row.get("profile_name", "")),
            connected_account_id=connected_account_id,
            mcp_qualified_name=mcp_name,
            is_active=is_active,
            is_default=row.get("is_default", False),
            is_default_for_dashboard=row.get("is_default_for_dashboard", False),
            is_connected=is_active,  # Simply mirrors is_active - Composio manages connection state
            enabled_tools=decrypted.get("enabled_tools", []),
            created_at=str(row.get("created_at")) if row.get("created_at") else None,
            updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
            last_used_at=str(row.get("last_used_at")) if row.get("last_used_at") else None
        )

    async def create_profile(
        self,
        user_id: str,
        request: CreateProfileRequest
    ) -> ComposioProfile:
        """
        Create a new Composio credential profile.

        Args:
            user_id: The Clerk user ID
            request: Profile creation request

        Returns:
            Created ComposioProfile

        Raises:
            ValueError: If profile name already exists
        """
        try:
            client = await self.db.client
            mcp_qualified_name = self._get_mcp_qualified_name(request.toolkit_slug)

            # Check for existing profiles with same name
            existing = await client.table(self.TABLE_NAME).select(
                "profile_id"
            ).eq("user_id", user_id).eq(
                "mcp_qualified_name", mcp_qualified_name
            ).eq("profile_name", request.profile_name).execute()

            if existing.data:
                raise ValueError(f"Profile '{request.profile_name}' already exists for {request.toolkit_slug}")

            # Check if this is the first profile for this toolkit
            all_profiles = await client.table(self.TABLE_NAME).select(
                "profile_id"
            ).eq("user_id", user_id).eq("mcp_qualified_name", mcp_qualified_name).execute()

            is_first_profile = len(all_profiles.data or []) == 0

            # Auto-set defaults for first profile
            is_default = request.is_default or is_first_profile
            is_default_for_dashboard = request.is_default_for_dashboard or is_first_profile

            # If setting as default, unset other defaults
            if is_default:
                await client.table(self.TABLE_NAME).update({
                    "is_default": False
                }).eq("user_id", user_id).eq("mcp_qualified_name", mcp_qualified_name).execute()

            if is_default_for_dashboard:
                await client.table(self.TABLE_NAME).update({
                    "is_default_for_dashboard": False
                }).eq("user_id", user_id).eq("mcp_qualified_name", mcp_qualified_name).execute()

            # Create encrypted config
            encrypted_config, config_hash = self._create_encrypted_config(
                connected_account_id=request.connected_account_id,
                enabled_tools=request.enabled_tools
            )

            display_name = request.display_name or f"{request.toolkit_slug.title()} - {request.profile_name}"
            now = datetime.utcnow().isoformat()

            # Insert profile
            profile_data = {
                "user_id": user_id,
                "mcp_qualified_name": mcp_qualified_name,
                "profile_name": request.profile_name,
                "display_name": display_name,
                "encrypted_config": encrypted_config,
                "config_hash": config_hash,
                "is_active": True,
                "is_default": is_default,
                "is_default_for_dashboard": is_default_for_dashboard,
                "created_at": now,
                "updated_at": now
            }

            result = await client.table(self.TABLE_NAME).insert(profile_data).execute()

            if not result.data:
                raise ValueError("Failed to create profile - no data returned")

            profile_row = result.data[0]
            logger.info(f"Created Composio profile {profile_row['profile_id']} for user {user_id}")

            return self._db_row_to_profile(profile_row)

        except Exception as e:
            logger.error(f"Failed to create profile: {e}")
            raise

    async def get_profile(self, profile_id: str, user_id: str) -> Optional[ComposioProfile]:
        """
        Get a profile by ID.

        Args:
            profile_id: The profile ID
            user_id: The user ID (for authorization)

        Returns:
            ComposioProfile if found and authorized, None otherwise
        """
        try:
            client = await self.db.client

            result = await client.table(self.TABLE_NAME).select("*").eq(
                "profile_id", profile_id
            ).eq("user_id", user_id).like(
                "mcp_qualified_name", f"{self.PROVIDER_PREFIX}:%"
            ).single().execute()

            if not result.data:
                return None

            # Verify it's a Composio profile
            mcp_name = result.data.get("mcp_qualified_name", "")
            if not mcp_name.startswith(f"{self.PROVIDER_PREFIX}:"):
                return None

            return self._db_row_to_profile(result.data)

        except Exception as e:
            logger.error(f"Failed to get profile {profile_id}: {e}")
            return None

    async def list_profiles(
        self,
        user_id: str,
        toolkit_slug: Optional[str] = None,
        active_only: bool = False
    ) -> List[ComposioProfile]:
        """
        List all Composio profiles for a user.

        Args:
            user_id: The Clerk user ID
            toolkit_slug: Optional filter by toolkit
            active_only: Only return active profiles

        Returns:
            List of ComposioProfile objects
        """
        try:
            client = await self.db.client

            query = client.table(self.TABLE_NAME).select("*").eq(
                "user_id", user_id
            ).like("mcp_qualified_name", f"{self.PROVIDER_PREFIX}:%")

            if toolkit_slug:
                mcp_qualified_name = self._get_mcp_qualified_name(toolkit_slug)
                query = query.eq("mcp_qualified_name", mcp_qualified_name)

            if active_only:
                query = query.eq("is_active", True)

            result = await query.order("created_at", desc=True).execute()

            profiles = []
            for row in result.data or []:
                try:
                    profile = self._db_row_to_profile(row)
                    profiles.append(profile)
                except Exception as e:
                    logger.warning(f"Failed to parse profile {row.get('profile_id')}: {e}")

            return profiles

        except Exception as e:
            logger.error(f"Failed to list profiles for user {user_id}: {e}")
            return []

    async def update_profile(
        self,
        profile_id: str,
        user_id: str,
        request: UpdateProfileRequest
    ) -> Optional[ComposioProfile]:
        """
        Update a profile.

        Args:
            profile_id: The profile ID
            user_id: The user ID (for authorization)
            request: Update request

        Returns:
            Updated ComposioProfile if successful
        """
        try:
            client = await self.db.client

            # Get existing profile
            existing = await self.get_profile(profile_id, user_id)
            if not existing:
                return None

            mcp_qualified_name = self._get_mcp_qualified_name(existing.toolkit_slug)
            update_data: Dict[str, Any] = {"updated_at": datetime.utcnow().isoformat()}

            if request.profile_name is not None:
                update_data["profile_name"] = request.profile_name

            if request.display_name is not None:
                update_data["display_name"] = request.display_name

            if request.is_active is not None:
                update_data["is_active"] = request.is_active

            # Handle default flags
            if request.is_default is True:
                # Unset other defaults first
                await client.table(self.TABLE_NAME).update({
                    "is_default": False
                }).eq("user_id", user_id).eq("mcp_qualified_name", mcp_qualified_name).execute()
                update_data["is_default"] = True
            elif request.is_default is False:
                update_data["is_default"] = False

            if request.is_default_for_dashboard is True:
                await client.table(self.TABLE_NAME).update({
                    "is_default_for_dashboard": False
                }).eq("user_id", user_id).eq("mcp_qualified_name", mcp_qualified_name).execute()
                update_data["is_default_for_dashboard"] = True
            elif request.is_default_for_dashboard is False:
                update_data["is_default_for_dashboard"] = False

            # Handle enabled_tools update (requires re-encryption)
            if request.enabled_tools is not None:
                encrypted_config, config_hash = self._create_encrypted_config(
                    connected_account_id=existing.connected_account_id,
                    enabled_tools=request.enabled_tools
                )
                update_data["encrypted_config"] = encrypted_config
                update_data["config_hash"] = config_hash

            result = await client.table(self.TABLE_NAME).update(
                update_data
            ).eq("profile_id", profile_id).eq("user_id", user_id).execute()

            if not result.data:
                return None

            return self._db_row_to_profile(result.data[0])

        except Exception as e:
            logger.error(f"Failed to update profile {profile_id}: {e}")
            return None

    async def delete_profile(self, profile_id: str, user_id: str) -> bool:
        """
        Delete a profile.

        Args:
            profile_id: The profile ID
            user_id: The user ID (for authorization)

        Returns:
            True if deletion succeeded
        """
        try:
            client = await self.db.client

            result = await client.table(self.TABLE_NAME).delete().eq(
                "profile_id", profile_id
            ).eq("user_id", user_id).like(
                "mcp_qualified_name", f"{self.PROVIDER_PREFIX}:%"
            ).execute()

            success = bool(result.data)
            if success:
                logger.info(f"Deleted Composio profile {profile_id}")

            return success

        except Exception as e:
            logger.error(f"Failed to delete profile {profile_id}: {e}")
            return False

    async def bulk_delete_profiles(self, profile_ids: List[str], user_id: str) -> int:
        """
        Bulk delete profiles.

        Args:
            profile_ids: List of profile IDs to delete
            user_id: The user ID (for authorization)

        Returns:
            Number of profiles deleted
        """
        deleted = 0
        for profile_id in profile_ids:
            if await self.delete_profile(profile_id, user_id):
                deleted += 1
        return deleted

    async def set_default_profile(self, profile_id: str, user_id: str) -> bool:
        """
        Set a profile as default for its toolkit.

        Args:
            profile_id: The profile ID
            user_id: The user ID

        Returns:
            True if successful
        """
        profile = await self.get_profile(profile_id, user_id)
        if not profile:
            return False

        request = UpdateProfileRequest(is_default=True)
        updated = await self.update_profile(profile_id, user_id, request)
        return updated is not None

    async def set_dashboard_default_profile(self, profile_id: str, user_id: str) -> bool:
        """
        Set a profile as default for dashboard MCP access.

        Args:
            profile_id: The profile ID
            user_id: The user ID

        Returns:
            True if successful
        """
        profile = await self.get_profile(profile_id, user_id)
        if not profile:
            return False

        request = UpdateProfileRequest(is_default_for_dashboard=True)
        updated = await self.update_profile(profile_id, user_id, request)
        return updated is not None

    async def check_name_availability(
        self,
        user_id: str,
        toolkit_slug: str,
        profile_name: str
    ) -> bool:
        """
        Check if a profile name is available.

        Args:
            user_id: The Clerk user ID
            toolkit_slug: The toolkit slug
            profile_name: Proposed profile name

        Returns:
            True if the name is available
        """
        try:
            client = await self.db.client
            mcp_qualified_name = self._get_mcp_qualified_name(toolkit_slug)

            result = await client.table(self.TABLE_NAME).select(
                "profile_id"
            ).eq("user_id", user_id).eq(
                "mcp_qualified_name", mcp_qualified_name
            ).eq("profile_name", profile_name).execute()

            return len(result.data or []) == 0

        except Exception as e:
            logger.error(f"Failed to check name availability: {e}")
            return False

    async def get_default_profile(
        self,
        user_id: str,
        toolkit_slug: str
    ) -> Optional[ComposioProfile]:
        """
        Get the default profile for a toolkit.

        Args:
            user_id: The Clerk user ID
            toolkit_slug: The toolkit slug

        Returns:
            Default ComposioProfile if exists
        """
        try:
            client = await self.db.client
            mcp_qualified_name = self._get_mcp_qualified_name(toolkit_slug)

            result = await client.table(self.TABLE_NAME).select("*").eq(
                "user_id", user_id
            ).eq("mcp_qualified_name", mcp_qualified_name).eq(
                "is_default", True
            ).single().execute()

            if not result.data:
                return None

            return self._db_row_to_profile(result.data)

        except Exception as e:
            logger.error(f"Failed to get default profile: {e}")
            return None

    async def update_last_used(self, profile_id: str, user_id: str) -> None:
        """Update the last_used_at timestamp for a profile."""
        try:
            client = await self.db.client
            await client.table(self.TABLE_NAME).update({
                "last_used_at": datetime.utcnow().isoformat()
            }).eq("profile_id", profile_id).eq("user_id", user_id).execute()
        except Exception as e:
            logger.warning(f"Failed to update last_used_at for profile {profile_id}: {e}")

    async def get_profiles_grouped_by_toolkit(
        self,
        user_id: str
    ) -> Dict[str, List[ComposioProfile]]:
        """
        Get all profiles grouped by toolkit.

        Args:
            user_id: The Clerk user ID

        Returns:
            Dict mapping toolkit_slug to list of profiles
        """
        profiles = await self.list_profiles(user_id)

        grouped: Dict[str, List[ComposioProfile]] = {}
        for profile in profiles:
            if profile.toolkit_slug not in grouped:
                grouped[profile.toolkit_slug] = []
            grouped[profile.toolkit_slug].append(profile)

        return grouped

