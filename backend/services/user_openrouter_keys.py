"""
User OpenRouter API Key Management Service

Handles secure storage, retrieval, and validation of user's OpenRouter API keys
for BYOK (Bring Your Own Key) functionality.
"""

import hashlib
import base64
import re
from typing import Optional, Dict, Any
from datetime import datetime, timezone
from pydantic import BaseModel

from utils.logger import logger
from utils.encryption import encrypt_data, decrypt_data
from services.supabase import DBConnection


class OpenRouterKeyInfo(BaseModel):
    """Information about a user's OpenRouter API key"""
    key_id: str
    account_id: str
    display_name: str
    is_active: bool
    last_used_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class OpenRouterKeyManager:
    """Manages OpenRouter API keys for BYOK users"""
    
    @staticmethod
    def _validate_key_format(api_key: str) -> bool:
        """Validate OpenRouter API key format"""
        if not api_key:
            return False
        
        # OpenRouter keys: sk-or-v1- followed by exactly 64 hexadecimal characters
        pattern = r'^sk-or-v1-[a-f0-9]{64}$'
        return bool(re.match(pattern, api_key, re.IGNORECASE))
    
    @staticmethod
    def _hash_key(api_key: str) -> str:
        """Create SHA-256 hash of API key for duplicate detection"""
        return hashlib.sha256(api_key.encode()).hexdigest()
    
    @staticmethod
    async def store_api_key(
        account_id: str, 
        api_key: str, 
        display_name: str = "OpenRouter API Key"
    ) -> str:
        """
        Store encrypted OpenRouter API key for user
        
        Args:
            account_id: User's account ID
            api_key: Raw OpenRouter API key
            display_name: User-friendly name for the key
            
        Returns:
            key_id: UUID of stored key
            
        Raises:
            ValueError: If key format is invalid
            Exception: If storage fails
        """
        if not OpenRouterKeyManager._validate_key_format(api_key):
            raise ValueError("Invalid OpenRouter API key format. Expected format: sk-or-v1-...")
        
        try:
            # Encrypt the API key
            encrypted_key = encrypt_data(api_key)
            key_hash = OpenRouterKeyManager._hash_key(api_key)
            
            # Store in database
            db = DBConnection()
            async with db.get_async_client() as client:
                # Encode encrypted data for database storage
                encoded_key = base64.b64encode(encrypted_key).decode('utf-8')
                
                # Upsert the key (replace if exists)
                result = await client.table('user_openrouter_keys').upsert({
                    'account_id': account_id,
                    'encrypted_api_key': encoded_key,
                    'key_hash': key_hash,
                    'display_name': display_name,
                    'is_active': True,
                    'updated_at': datetime.now(timezone.utc).isoformat()
                }, on_conflict='account_id').execute()
                
                if not result.data:
                    raise Exception("Failed to store OpenRouter API key")
                
                key_id = result.data[0]['key_id']
                logger.info(f"Successfully stored OpenRouter API key for user {account_id}")
                return key_id
                
        except Exception as e:
            logger.error(f"Error storing OpenRouter API key for user {account_id}: {str(e)}")
            raise
    
    @staticmethod
    async def get_api_key(account_id: str) -> Optional[str]:
        """
        Retrieve and decrypt user's OpenRouter API key
        
        Args:
            account_id: User's account ID
            
        Returns:
            Decrypted API key or None if not found/inactive
        """
        try:
            db = DBConnection()
            async with db.get_async_client() as client:
                result = await client.table('user_openrouter_keys')\
                    .select('encrypted_api_key')\
                    .eq('account_id', account_id)\
                    .eq('is_active', True)\
                    .execute()
                
                if not result.data:
                    return None
                
                # Decode and decrypt the API key
                encoded_key = result.data[0]['encrypted_api_key']
                encrypted_key = base64.b64decode(encoded_key.encode('utf-8'))
                api_key = decrypt_data(encrypted_key)
                
                return api_key
                
        except Exception as e:
            logger.error(f"Error retrieving OpenRouter API key for user {account_id}: {str(e)}")
            return None
    
    @staticmethod
    async def get_key_info(account_id: str) -> Optional[OpenRouterKeyInfo]:
        """
        Get information about user's OpenRouter API key (without the actual key)
        
        Args:
            account_id: User's account ID
            
        Returns:
            Key information or None if not found
        """
        try:
            db = DBConnection()
            async with db.get_async_client() as client:
                result = await client.table('user_openrouter_keys')\
                    .select('key_id, account_id, display_name, is_active, last_used_at, created_at, updated_at')\
                    .eq('account_id', account_id)\
                    .execute()
                
                if not result.data:
                    return None
                
                data = result.data[0]
                return OpenRouterKeyInfo(
                    key_id=data['key_id'],
                    account_id=data['account_id'],
                    display_name=data['display_name'],
                    is_active=data['is_active'],
                    last_used_at=datetime.fromisoformat(data['last_used_at']) if data['last_used_at'] else None,
                    created_at=datetime.fromisoformat(data['created_at']),
                    updated_at=datetime.fromisoformat(data['updated_at'])
                )
                
        except Exception as e:
            logger.error(f"Error getting OpenRouter key info for user {account_id}: {str(e)}")
            return None
    
    @staticmethod
    async def delete_api_key(account_id: str) -> bool:
        """
        Delete user's OpenRouter API key
        
        Args:
            account_id: User's account ID
            
        Returns:
            True if deleted successfully, False otherwise
        """
        try:
            db = DBConnection()
            async with db.get_async_client() as client:
                result = await client.table('user_openrouter_keys')\
                    .delete()\
                    .eq('account_id', account_id)\
                    .execute()
                
                logger.info(f"Deleted OpenRouter API key for user {account_id}")
                return True
                
        except Exception as e:
            logger.error(f"Error deleting OpenRouter API key for user {account_id}: {str(e)}")
            return False
    
    @staticmethod
    async def update_last_used(account_id: str) -> None:
        """
        Update the last_used_at timestamp for user's API key
        
        Args:
            account_id: User's account ID
        """
        try:
            db = DBConnection()
            async with db.get_async_client() as client:
                await client.table('user_openrouter_keys')\
                    .update({'last_used_at': datetime.now(timezone.utc).isoformat()})\
                    .eq('account_id', account_id)\
                    .eq('is_active', True)\
                    .execute()
                
        except Exception as e:
            logger.error(f"Error updating last_used_at for user {account_id}: {str(e)}")
    
    @staticmethod
    async def set_key_active_status(account_id: str, is_active: bool) -> bool:
        """
        Set the active status of user's OpenRouter API key
        
        Args:
            account_id: User's account ID
            is_active: Whether the key should be active (True) or inactive (False)
            
        Returns:
            bool: True if update was successful, False otherwise
        """
        try:
            db = DBConnection()
            async with db.get_async_client() as client:
                result = await client.table('user_openrouter_keys')\
                    .update({'is_active': is_active, 'updated_at': datetime.now(timezone.utc).isoformat()})\
                    .eq('account_id', account_id)\
                    .execute()
                
                if result.data:
                    status_text = "activated" if is_active else "deactivated"
                    logger.info(f"OpenRouter API key {status_text} for user {account_id}")
                    return True
                else:
                    logger.warning(f"No OpenRouter API key found for user {account_id} to update status")
                    return False
                
        except Exception as e:
            logger.error(f"Error setting key active status for user {account_id}: {str(e)}")
            return False
    
    @staticmethod
    async def test_api_key_connection(api_key: str) -> Dict[str, Any]:
        """
        Test OpenRouter API key by making a simple API call and getting detailed status
        
        Args:
            api_key: OpenRouter API key to test
            
        Returns:
            Dict with 'success' bool, 'message' or 'error', and optional 'key_info'
        """
        try:
            import aiohttp
            import json
            
            # First test with key status endpoint for detailed information
            key_status_url = "https://openrouter.ai/api/v1/auth/key"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(key_status_url, headers=headers, timeout=10) as response:
                    if response.status == 200:
                        key_data = await response.json()
                        data = key_data.get('data', {})
                        
                        # Extract key information
                        usage = data.get('usage', 0)
                        limit = data.get('limit')
                        is_free_tier = data.get('is_free_tier', False)
                        limit_remaining = data.get('limit_remaining')
                        
                        # Check if key has sufficient credits
                        if limit is not None and limit_remaining is not None and limit_remaining <= 0:
                            return {
                                "success": False,
                                "error": f"API key has no remaining credits ({limit_remaining}/{limit} credits remaining)",
                                "key_info": {
                                    "usage": usage,
                                    "limit": limit,
                                    "limit_remaining": limit_remaining,
                                    "is_free_tier": is_free_tier
                                }
                            }
                        
                        return {
                            "success": True,
                            "message": "OpenRouter API key is valid and working",
                            "key_info": {
                                "usage": usage,
                                "limit": limit,
                                "limit_remaining": limit_remaining,
                                "is_free_tier": is_free_tier
                            }
                        }
                    elif response.status == 401:
                        return {
                            "success": False,
                            "error": "Invalid OpenRouter API key or expired session"
                        }
                    elif response.status == 429:
                        return {
                            "success": False,
                            "error": "Rate limit exceeded on OpenRouter account. Please try again later."
                        }
                    elif response.status == 402:
                        return {
                            "success": False,
                            "error": "Insufficient credits in OpenRouter account. Please add more credits."
                        }
                    else:
                        # Try to get error details from response
                        try:
                            error_data = await response.json()
                            error_msg = error_data.get('error', {}).get('message', f"HTTP {response.status}")
                        except:
                            error_msg = f"HTTP {response.status}"
                        
                        return {
                            "success": False,
                            "error": f"OpenRouter API error: {error_msg}"
                        }
                        
        except aiohttp.ClientTimeout:
            return {
                "success": False,
                "error": "Request timed out. Please check your internet connection and try again."
            }
        except aiohttp.ClientConnectorError:
            return {
                "success": False,
                "error": "Unable to connect to OpenRouter. Please check your internet connection."
            }
        except Exception as e:
            logger.error(f"Error testing OpenRouter API key: {str(e)}")
            return {
                "success": False,
                "error": f"Connection test failed: {str(e)}"
            }