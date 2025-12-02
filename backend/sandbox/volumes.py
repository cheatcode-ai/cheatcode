"""
Daytona Volumes Module - Persistent storage management for sandboxes.

This module provides volume management for caching npm/pnpm packages
and persisting data across sandbox sessions.
"""

import asyncio
from typing import Optional, List, Dict, Any
from daytona import AsyncDaytona, DaytonaConfig
from utils.logger import logger
from utils.config import config


class VolumeManager:
    """Manages Daytona volumes for persistent storage across sandbox sessions.

    Volumes allow data to persist even when sandboxes are stopped or restarted,
    making them ideal for caching package dependencies.
    """

    def __init__(self):
        """Initialize the VolumeManager with Daytona client."""
        self._daytona: Optional[AsyncDaytona] = None

    async def _get_daytona(self) -> AsyncDaytona:
        """Get or create the Daytona client."""
        if self._daytona is None:
            daytona_config = DaytonaConfig(
                api_key=config.DAYTONA_API_KEY,
                api_url=config.DAYTONA_SERVER_URL,
                target=config.DAYTONA_TARGET,
            )
            self._daytona = AsyncDaytona(daytona_config)
        return self._daytona

    async def get_or_create_volume(self, volume_name: str, wait_ready: bool = True) -> Dict[str, Any]:
        """Get an existing volume or create a new one.

        Args:
            volume_name: Name of the volume
            wait_ready: If True, wait for volume to be ready before returning

        Returns:
            Dictionary with volume information (id, name, state)
        """
        daytona = await self._get_daytona()

        try:
            # Try to get existing volume, create if doesn't exist
            volume = await daytona.volume.get(volume_name, create=True)

            # Wait for volume to be ready if requested
            if wait_ready:
                max_wait = 60  # seconds
                poll_interval = 2  # seconds
                waited = 0

                while hasattr(volume, 'state') and str(volume.state).lower() in ['pending_create', 'creating']:
                    if waited >= max_wait:
                        logger.error(f"Volume {volume_name} stuck in {volume.state} state after {max_wait}s")
                        raise Exception(f"Volume {volume_name} not ready after {max_wait}s (state: {volume.state})")

                    logger.debug(f"Waiting for volume {volume_name} to be ready (state: {volume.state}, waited: {waited}s)")
                    await asyncio.sleep(poll_interval)
                    volume = await daytona.volume.get(volume_name)
                    waited += poll_interval

            state_str = str(volume.state) if hasattr(volume, 'state') else 'unknown'
            logger.info(f"Got/created volume: {volume.name} (ID: {volume.id}, state: {state_str})")
            return {
                'id': volume.id,
                'name': volume.name,
                'state': state_str,
            }
        except Exception as e:
            logger.error(f"Failed to get/create volume {volume_name}: {e}")
            raise

    async def get_or_create_cache_volume(
        self,
        account_id: str,
        cache_type: str = "npm"
    ) -> str:
        """Get or create a cache volume for a user account.

        Args:
            account_id: User's account ID
            cache_type: Type of cache (npm, pnpm, build)

        Returns:
            Volume ID
        """
        # Create a deterministic volume name based on account and cache type
        volume_name = f"cache-{cache_type}-{account_id[:12]}"

        try:
            volume_info = await self.get_or_create_volume(volume_name)
            return volume_info['id']
        except Exception as e:
            logger.error(f"Failed to get/create cache volume {volume_name}: {e}")
            raise

    async def list_volumes(self) -> List[Dict[str, Any]]:
        """List all volumes.

        Returns:
            List of volume dictionaries
        """
        daytona = await self._get_daytona()

        try:
            volumes = await daytona.volume.list()
            return [
                {
                    'id': v.id,
                    'name': v.name,
                    'state': str(v.state) if hasattr(v, 'state') else 'unknown',
                }
                for v in volumes
            ]
        except Exception as e:
            logger.error(f"Failed to list volumes: {e}")
            return []

    async def list_user_volumes(self, account_id: str) -> List[Dict[str, Any]]:
        """List all volumes for a specific user account.

        Args:
            account_id: User's account ID

        Returns:
            List of volume dictionaries belonging to the user
        """
        try:
            all_volumes = await self.list_volumes()
            # Filter volumes that contain the account_id in their name
            user_volumes = [
                v for v in all_volumes
                if account_id[:12] in v.get('name', '')
            ]
            return user_volumes
        except Exception as e:
            logger.error(f"Failed to list volumes for account {account_id}: {e}")
            return []

    async def delete_volume(self, volume_name: str) -> bool:
        """Delete a volume by name.

        Args:
            volume_name: Name of the volume to delete

        Returns:
            True if deleted successfully
        """
        daytona = await self._get_daytona()

        try:
            volume = await daytona.volume.get(volume_name)
            await daytona.volume.delete(volume)
            logger.info(f"Deleted volume: {volume_name}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete volume {volume_name}: {e}")
            raise

    async def delete_user_volumes(self, account_id: str) -> int:
        """Delete all volumes for a user account.

        Args:
            account_id: User's account ID

        Returns:
            Number of volumes deleted
        """
        user_volumes = await self.list_user_volumes(account_id)
        deleted_count = 0

        for volume in user_volumes:
            try:
                await self.delete_volume(volume['name'])
                deleted_count += 1
            except Exception as e:
                logger.warning(f"Failed to delete volume {volume['name']}: {e}")

        logger.info(f"Deleted {deleted_count} volumes for account {account_id}")
        return deleted_count

    async def get_cache_volume_mounts(
        self,
        account_id: str,
        include_npm: bool = True,
        include_pnpm: bool = True
    ) -> List[Dict[str, str]]:
        """Get volume mount configurations for cache volumes.

        This returns a list of volume mounts that can be passed to
        CreateSandboxFromSnapshotParams for attaching persistent caches.

        Args:
            account_id: User's account ID
            include_npm: Whether to include npm cache volume
            include_pnpm: Whether to include pnpm store volume

        Returns:
            List of volume mount configurations
        """
        mounts = []

        try:
            if include_npm:
                npm_volume_id = await self.get_or_create_cache_volume(account_id, "npm")
                mounts.append({
                    "volumeId": npm_volume_id,
                    "mountPath": "/home/daytona/.npm"
                })

            if include_pnpm:
                pnpm_volume_id = await self.get_or_create_cache_volume(account_id, "pnpm")
                mounts.append({
                    "volumeId": pnpm_volume_id,
                    "mountPath": "/home/daytona/.pnpm-store"
                })

        except Exception as e:
            logger.warning(f"Failed to get cache volume mounts for {account_id}: {e}")
            # Return empty list - volumes are optional optimization

        return mounts


# Global instance for easy access
volume_manager = VolumeManager()


async def get_cache_volumes_for_sandbox(account_id: str) -> List[Dict[str, str]]:
    """Convenience function to get cache volume mounts for sandbox creation.

    Args:
        account_id: User's account ID

    Returns:
        List of volume mount configurations
    """
    return await volume_manager.get_cache_volume_mounts(account_id)
