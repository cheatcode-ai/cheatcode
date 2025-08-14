from typing import List, Dict, Any, Optional
from uuid import UUID
from pydantic import BaseModel, Field
from datetime import datetime
import asyncio
import json
import hashlib

from utils.logger import logger
from services.supabase import DBConnection
from utils.encryption import encrypt_data, decrypt_data
from .client import get_pipedream_client


class PipedreamProfile(BaseModel):
    profile_id: UUID
    account_id: str  # Changed from UUID to str to support Clerk user IDs
    mcp_qualified_name: str
    profile_name: str
    display_name: str
    encrypted_config: str
    config_hash: str
    is_active: bool = True
    is_default: bool = False
    is_default_for_dashboard: bool = False  # New field for dashboard MCP access
    created_at: datetime
    updated_at: datetime
    last_used_at: Optional[datetime] = None
    # Pipedream specific fields
    app_slug: str
    app_name: str
    external_user_id: str
    is_connected: bool = False
    enabled_tools: List[str] = Field(default_factory=list)


class CreateProfileRequest(BaseModel):
    profile_name: str
    app_slug: str
    app_name: str
    description: Optional[str] = None
    is_default: bool = False
    is_default_for_dashboard: bool = False
    oauth_app_id: Optional[str] = None
    enabled_tools: List[str] = Field(default_factory=list)
    external_user_id: Optional[str] = None  # Add this field


class UpdateProfileRequest(BaseModel):
    profile_name: Optional[str] = None
    display_name: Optional[str] = None
    is_active: Optional[bool] = None
    is_default_for_dashboard: Optional[bool] = None
    is_default: Optional[bool] = None
    enabled_tools: Optional[List[str]] = None


class ProfileManager:
    def __init__(self, db: DBConnection):
        self.db = db
        self.pipedream_client = get_pipedream_client()
    
    def _generate_external_user_id(self, account_id: str, app_slug: str, profile_name: str) -> str:
        """Generate external_user_id for Pipedream - use Clerk user ID for consistency"""
        # Always use the Clerk user ID (account_id) as external_user_id for consistency
        # This ensures OAuth connections and profile lookups use the same identifier
        return account_id
    
    def _get_mcp_qualified_name(self, app_slug: str) -> str:
        """Convert app_slug to MCP qualified name for Pipedream"""
        return f"pipedream:{app_slug}"
    
    async def create_profile(
        self, 
        account_id: str, 
        request: CreateProfileRequest
    ) -> PipedreamProfile:
        """Create a new credential profile for a Pipedream app"""
        try:
            # Get async client
            client = await self.db.client
            
            # Use provided external_user_id or use Clerk user ID for consistency
            # Per Pipedream Connect docs, external_user_id should be consistent across all operations
            if request.external_user_id:
                external_user_id = request.external_user_id
            else:
                external_user_id = self._generate_external_user_id(
                    account_id, 
                    request.app_slug, 
                    request.profile_name
                )
            
            logger.info(f"Using external_user_id: {external_user_id} for account: {account_id}")
            
            # Auto-discover and enable all available tools if none specified
            enabled_tools = request.enabled_tools or []
            if not enabled_tools:
                try:
                    logger.info(f"Auto-discovering tools for {request.app_slug}")
                    # Try to get all available tools for this app
                    mcp_servers = await self.pipedream_client.discover_mcp_servers(
                        external_user_id=external_user_id,
                        app_slug=request.app_slug
                    )
                    
                    # Find the server for this app
                    for server in mcp_servers:
                        if server.get('app_slug') == request.app_slug and server.get('status') == 'connected':
                            available_tools = server.get('available_tools', [])
                            enabled_tools = [tool['name'] for tool in available_tools if 'name' in tool]
                            logger.info(f"Auto-enabled {len(enabled_tools)} tools for {request.app_slug}: {enabled_tools}")
                            break
                except Exception as e:
                    logger.warning(f"Could not auto-discover tools for {request.app_slug}: {str(e)}")
                    # Continue with empty tools list if discovery fails
            
            # Create config object
            config = {
                "app_slug": request.app_slug,
                "app_name": request.app_name,
                "external_user_id": external_user_id,
                "oauth_app_id": request.oauth_app_id,
                "enabled_tools": enabled_tools
            }
            
            # Encrypt config
            config_json = json.dumps(config)
            encrypted_config = encrypt_data(config_json)
            config_hash = hashlib.sha256(config_json.encode()).hexdigest()
            
            mcp_qualified_name = self._get_mcp_qualified_name(request.app_slug)
            
            # Check if there are existing profiles for this app
            existing_profiles_result = await client.table('user_mcp_credential_profiles').select(
                'profile_id'
            ).eq('account_id', account_id).eq('mcp_qualified_name', mcp_qualified_name).execute()
            
            existing_profiles = existing_profiles_result.data or []
            is_first_profile = len(existing_profiles) == 0
            
            # Auto-set as default if this is the first profile for this app
            is_default = request.is_default or is_first_profile
            is_default_for_dashboard = request.is_default_for_dashboard or is_first_profile
            
            logger.info(f"Profile settings - is_first: {is_first_profile}, is_default: {is_default}, is_default_for_dashboard: {is_default_for_dashboard}")
            
            # If this is set as default, unset other defaults for this MCP
            if is_default:
                await client.table('user_mcp_credential_profiles').update({
                    'is_default': False
                }).eq('account_id', account_id).eq('mcp_qualified_name', mcp_qualified_name).execute()
            
            # If this is set as default for dashboard, unset others
            if is_default_for_dashboard:
                await client.table('user_mcp_credential_profiles').update({
                    'is_default_for_dashboard': False
                }).eq('account_id', account_id).eq('mcp_qualified_name', mcp_qualified_name).execute()
            
            # Check if already connected before creating profile
            is_connected = False
            try:
                connections = await self.pipedream_client.get_connections(external_user_id)
                is_connected = any(
                    conn.get('name_slug') == request.app_slug 
                    for conn in connections
                )
            except Exception as e:
                logger.warning(f"Error checking connection status: {str(e)}")
            
            # Create the profile
            profile_data = {
                'account_id': account_id,
                'mcp_qualified_name': mcp_qualified_name,
                'profile_name': request.profile_name,
                'display_name': f"{request.app_name} - {request.profile_name}",
                'encrypted_config': encrypted_config,
                'config_hash': config_hash,
                'is_default': is_default,
                'is_default_for_dashboard': is_default_for_dashboard
            }
            
            # Insert to database with error handling for duplicates
            try:
                result = await client.table('user_mcp_credential_profiles').insert(
                    profile_data
                ).execute()
                
                if not result.data:
                    raise ValueError("Failed to create profile - no data returned")
                
                profile = result.data[0]
            except Exception as db_error:
                # Handle duplicate key error gracefully
                if "duplicate key value violates unique constraint" in str(db_error):
                    logger.warning(f"Profile already exists for {account_id}, {mcp_qualified_name}, {request.profile_name}")
                    # Try to get existing profile
                    existing_result = await client.table('user_mcp_credential_profiles').select('*').eq(
                        'account_id', account_id
                    ).eq('mcp_qualified_name', mcp_qualified_name).eq(
                        'profile_name', request.profile_name
                    ).execute()
                    
                    if existing_result.data:
                        profile = existing_result.data[0]
                        logger.info(f"Using existing profile: {profile['profile_id']}")
                    else:
                        raise ValueError("Profile exists but could not be retrieved")
                else:
                    raise db_error
            
            # Add Pipedream specific fields for response
            profile['app_slug'] = request.app_slug
            profile['app_name'] = request.app_name
            profile['external_user_id'] = external_user_id
            profile['is_connected'] = is_connected
            profile['enabled_tools'] = enabled_tools
            
            # Update last_used_at if connected
            if is_connected:
                try:
                    await client.table('user_mcp_credential_profiles').update({
                        'last_used_at': datetime.utcnow().isoformat()
                    }).eq('profile_id', profile['profile_id']).execute()
                    profile['last_used_at'] = datetime.utcnow()
                except Exception as e:
                    logger.warning(f"Error updating last_used_at: {str(e)}")
            
            logger.info(f"Created credential profile: {profile['profile_id']} for app: {request.app_slug} with {len(enabled_tools)} tools enabled")
            if enabled_tools and len(enabled_tools) > 0:
                logger.info(f"Auto-enabled tools: {enabled_tools}")
            
            # Validate the profile data before returning
            return PipedreamProfile(**profile)
            
        except Exception as e:
            logger.error(f"Error creating credential profile: {str(e)}")
            raise
    
    async def create_profile_from_connection(
        self,
        account_id: str,
        user_id: str,
        app_slug: str,
        app_name: str,
        profile_name: str,
        is_default: bool = False
    ) -> PipedreamProfile:
        """Create a profile from an existing Pipedream connection"""
        request = CreateProfileRequest(
            profile_name=profile_name,
            app_slug=app_slug,
            app_name=app_name,
            is_default=is_default,
            external_user_id=user_id  # Use the actual Pipedream user_id
        )
        
        return await self.create_profile(account_id, request)
    
    async def get_profiles(
        self, 
        account_id: str, 
        app_slug: Optional[str] = None,
        is_active: Optional[bool] = None
    ) -> List[PipedreamProfile]:
        """Get credential profiles for an account"""
        try:
            # Get async client
            client = await self.db.client
            
            query = client.table('user_mcp_credential_profiles').select(
                '*'
            ).eq('account_id', account_id)
            
            if app_slug:
                mcp_qualified_name = self._get_mcp_qualified_name(app_slug)
                query = query.eq('mcp_qualified_name', mcp_qualified_name)
            else:
                # Only get Pipedream profiles
                query = query.like('mcp_qualified_name', 'pipedream:%')
            
            if is_active is not None:
                query = query.eq('is_active', is_active)
            
            result = await query.order('created_at', desc=True).execute()
            
            profiles = []
            for profile_data in result.data:
                try:
                    decrypted_config = await asyncio.to_thread(
                        decrypt_data, profile_data['encrypted_config']
                    )
                    config = json.loads(decrypted_config)
                    
                    profile_data['app_slug'] = config.get('app_slug', '')
                    profile_data['app_name'] = config.get('app_name', '')
                    profile_data['external_user_id'] = config.get('external_user_id', '')
                    profile_data['enabled_tools'] = config.get('enabled_tools', [])
                    
                    is_connected = False
                    try:
                        connections = await self.pipedream_client.get_connections(
                            profile_data['external_user_id']
                        )
                        
                        is_connected = any(
                            conn.get('name_slug') == profile_data['app_slug'] 
                            for conn in connections
                        )
                        
                        if is_connected and profile_data.get('last_used_at') is None:
                            await client.table('user_mcp_credential_profiles').update({
                                'last_used_at': datetime.utcnow().isoformat()
                            }).eq('profile_id', profile_data['profile_id']).execute()
                            
                            profile_data['last_used_at'] = datetime.utcnow()
                            
                    except Exception as e:
                        logger.warning(f"Error checking connection status: {str(e)}")
                    
                    profile_data['is_connected'] = is_connected
                    
                    profiles.append(PipedreamProfile(**profile_data))
                    
                except Exception as e:
                    logger.error(f"Error decrypting profile config: {str(e)}")
                    continue
            
            return profiles
            
        except Exception as e:
            logger.error(f"Error getting credential profiles: {str(e)}")
            raise
    
    async def get_profile(self, account_id: str, profile_id: str) -> Optional[PipedreamProfile]:
        try:
            # Get async client
            client = await self.db.client
            
            result = await client.table('user_mcp_credential_profiles').select(
                '*'
            ).eq('account_id', account_id).eq('profile_id', profile_id).single().execute()
            
            if not result.data:
                return None
            
            profile_data = result.data

            try:
                decrypted_config = await asyncio.to_thread(
                    decrypt_data, profile_data['encrypted_config']
                )
                config = json.loads(decrypted_config)

                profile_data['app_slug'] = config.get('app_slug', '')
                profile_data['app_name'] = config.get('app_name', '')
                profile_data['external_user_id'] = config.get('external_user_id', '')
                profile_data['enabled_tools'] = config.get('enabled_tools', [])
                
                is_connected = False
                try:
                    connections = await self.pipedream_client.get_connections(
                        profile_data['external_user_id']
                    )
                    
                    is_connected = any(
                        conn.get('name_slug') == profile_data['app_slug'] 
                        for conn in connections
                    )
                except Exception as e:
                    logger.warning(f"Error checking connection status: {str(e)}")
                
                profile_data['is_connected'] = is_connected
                
                return PipedreamProfile(**profile_data)
                
            except Exception as e:
                logger.error(f"Error decrypting profile config: {str(e)}")
                return None
            
        except Exception as e:
            logger.error(f"Error getting credential profile: {str(e)}")
            raise
    
    async def update_profile(
        self, 
        account_id: str, 
        profile_id: str, 
        request: UpdateProfileRequest
    ) -> PipedreamProfile:
        try:
            current = await self.get_profile(account_id, profile_id)
            if not current:
                raise ValueError("Profile not found")
            
            update_data = {}
            config_updated = False
            
            decrypted_config = await asyncio.to_thread(
                decrypt_data, current.encrypted_config
            )
            config = json.loads(decrypted_config)
            
            if request.profile_name is not None:
                update_data['profile_name'] = request.profile_name
            
            if request.display_name is not None:
                update_data['display_name'] = request.display_name
            
            if request.is_active is not None:
                update_data['is_active'] = request.is_active
            
            if request.is_default is not None:
                if request.is_default:
                    client = await self.db.client
                    await client.table('user_mcp_credential_profiles').update({
                        'is_default': False
                    }).eq('account_id', account_id).eq('mcp_qualified_name', current.mcp_qualified_name).execute()
                
                update_data['is_default'] = request.is_default
            
            if request.is_default_for_dashboard is not None:
                update_data['is_default_for_dashboard'] = request.is_default_for_dashboard
            
            # Update enabled tools if provided
            if request.enabled_tools is not None:
                config['enabled_tools'] = request.enabled_tools
                config_updated = True
            
            # Re-encrypt config if updated
            if config_updated:
                config_json = json.dumps(config)
                update_data['encrypted_config'] = encrypt_data(config_json)
                update_data['config_hash'] = hashlib.sha256(config_json.encode()).hexdigest()
            
            # Update profile
            if update_data:
                client = await self.db.client
                result = await client.table('user_mcp_credential_profiles').update(
                    update_data
                ).eq('profile_id', profile_id).eq('account_id', account_id).execute()
            
            return await self.get_profile(account_id, profile_id)
            
        except Exception as e:
            logger.error(f"Error updating credential profile: {str(e)}")
            raise
    
    async def delete_profile(self, account_id: str, profile_id: str) -> bool:
        """Delete a credential profile"""
        try:
            # Check if profile exists and belongs to account
            profile = await self.get_profile(account_id, profile_id)
            if not profile:
                return False
            
            # Delete profile
            client = await self.db.client
            await client.table('user_mcp_credential_profiles').delete().eq(
                'profile_id', profile_id
            ).eq('account_id', account_id).execute()
            
            logger.info(f"Deleted credential profile: {profile_id}")
            
            return True
            
        except Exception as e:
            logger.error(f"Error deleting credential profile: {str(e)}")
            raise
    
    async def connect_profile(self, account_id: str, profile_id: str, app: Optional[str] = None) -> Dict[str, Any]:
        """Generate connection token for a profile"""
        try:
            profile = await self.get_profile(account_id, profile_id)
            if not profile:
                raise ValueError("Profile not found")
            
            # Create connection token with profile's external_user_id
            result = await self.pipedream_client.create_connection_token(
                profile.external_user_id,
                app or profile.app_slug
            )

            client = await self.db.client
            await client.table('user_mcp_credential_profiles').update({
                'last_used_at': datetime.utcnow().isoformat()
            }).eq('profile_id', profile_id).execute()
            
            return {
                'success': True,
                'link': result.get('connect_link_url'),
                'token': result.get('token'),
                'profile_id': str(profile_id),
                'external_user_id': profile.external_user_id,
                'app': app or profile.app_slug
            }
            
        except Exception as e:
            logger.error(f"Error connecting profile: {str(e)}")
            raise
    
    async def get_profile_connections(self, account_id: str, profile_id: str) -> List[Dict[str, Any]]:
        """Get connections for a specific profile"""
        try:
            profile = await self.get_profile(account_id, profile_id)
            if not profile:
                raise ValueError("Profile not found")
            
            connections = await self.pipedream_client.get_connections(profile.external_user_id)
            
            return connections
            
        except Exception as e:
            logger.error(f"Error getting profile connections: {str(e)}")
            raise
    
    async def get_profile_by_app(self, account_id: str, app_slug: str, profile_name: Optional[str] = None) -> Optional[PipedreamProfile]:
        """Get a profile by app slug and optionally profile name"""
        try:
            profiles = await self.get_profiles(account_id, app_slug=app_slug, is_active=True)
            
            if not profiles:
                return None
            
            if profile_name:
                # Find specific profile by name
                for profile in profiles:
                    if profile.profile_name == profile_name:
                        return profile
                return None
            else:
                # Return default profile or first active profile
                for profile in profiles:
                    if profile.is_default:
                        return profile
                
                # No default, return first active profile
                return profiles[0] if profiles else None
            
        except Exception as e:
            logger.error(f"Error getting profile by app: {str(e)}")
            raise


# Singleton instance
_profile_manager: Optional[ProfileManager] = None

def get_profile_manager(db: DBConnection) -> ProfileManager:
    global _profile_manager
    if _profile_manager is None:
        _profile_manager = ProfileManager(db)
    return _profile_manager 