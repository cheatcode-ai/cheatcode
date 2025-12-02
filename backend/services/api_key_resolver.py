"""
API Key Resolution Service

Determines which API key to use for LLM calls based on user's plan and BYOK configuration.
Handles the logic for BYOK users vs regular users.
Enhanced with centralized Redis caching for optimal performance.
"""

import time
from typing import Optional, Tuple, Literal
from utils.logger import logger
from services.user_openrouter_keys import OpenRouterKeyManager
from services.supabase import DBConnection
from services import redis
from utils.config import config

# Cache configuration for user plans
USER_PLAN_CACHE_TTL = 300  # 5 minutes TTL for user plan data

KeySource = Literal["user_byok", "system", "none"]


class APIKeyResolver:
    """Resolves which OpenRouter API key to use for a given user"""
    
    @staticmethod
    async def get_openrouter_key_for_user(account_id: str) -> Tuple[Optional[str], KeySource, Optional[str]]:
        """
        Get the appropriate OpenRouter API key for a user
        
        Args:
            account_id: User's account ID
            
        Returns:
            Tuple of (api_key, source, error_message)
            - api_key: The API key to use, or None if no key available
            - source: Where the key came from ("user_byok", "system", "none")
            - error_message: Error message if no key available, None otherwise
        """
        try:
            # First, check user's plan using centralized caching
            user_plan = await APIKeyResolver.get_user_plan_cached(account_id)
            
            if user_plan == 'byok':
                # BYOK user - try to get their API key
                user_key = await OpenRouterKeyManager.get_api_key(account_id)
                if user_key:
                    logger.debug(f"Using BYOK OpenRouter key for user {account_id}")
                    return user_key, "user_byok", None
                else:
                    # BYOK user but no key configured
                    error_msg = "BYOK plan requires OpenRouter API key. Please configure your API key in settings."
                    logger.warning(f"BYOK user {account_id} has no API key configured")
                    return None, "none", error_msg
            else:
                # Regular user - use system key
                system_key = config.OPENROUTER_API_KEY
                if system_key:
                    logger.debug(f"Using system OpenRouter key for user {account_id} (plan: {user_plan})")
                    return system_key, "system", None
                else:
                    # System key not configured
                    error_msg = "System OpenRouter API key not configured"
                    logger.error(f"System OpenRouter API key not available for user {account_id}")
                    return None, "none", error_msg
                    
        except Exception as e:
            error_msg = f"Error resolving API key for user {account_id}: {str(e)}"
            logger.error(error_msg)
            return None, "none", error_msg
    
    @staticmethod
    async def get_user_plan_cached(account_id: str) -> str:
        """
        Get user's current billing plan with Redis caching for optimal performance
        
        Args:
            account_id: User's account ID
            
        Returns:
            Plan ID (e.g., 'free', 'pro', 'premium', 'byok')
        """
        cache_key = f"user_plan:{account_id}"
        
        try:
            # 🚀 CACHE OPTIMIZATION: Try Redis cache first
            cached_plan = await redis.get(cache_key)
            if cached_plan:
                logger.debug(f"✅ Cache HIT: User {account_id} plan from cache: {cached_plan}")
                return cached_plan
            
            logger.debug(f"❌ Cache MISS: Fetching user {account_id} plan from database")
            
            # Cache miss - fetch from database
            plan_id = await APIKeyResolver._fetch_user_plan_from_db(account_id)
            
            # 💾 Cache the result
            await redis.set(cache_key, plan_id, ex=USER_PLAN_CACHE_TTL)
            logger.debug(f"💾 Cached plan for user {account_id}: {plan_id} (TTL: {USER_PLAN_CACHE_TTL}s)")
            
            return plan_id
            
        except Exception as e:
            logger.error(f"Error getting cached user plan for {account_id}: {str(e)}")
            # Fallback to direct database fetch
            return await APIKeyResolver._fetch_user_plan_from_db(account_id)
    
    @staticmethod
    async def _fetch_user_plan_from_db(account_id: str) -> str:
        """
        Fetch user's billing plan directly from database (no caching)
        
        Args:
            account_id: User's account ID
            
        Returns:
            Plan ID (e.g., 'free', 'pro', 'premium', 'byok')
        """
        try:
            db = DBConnection()
            async with db.get_async_client() as client:
                result = await client.table('users')\
                    .select('plan_id')\
                    .eq('id', account_id)\
                    .execute()
                
                if result.data:
                    plan_id = result.data[0]['plan_id']
                    logger.debug(f"Database fetch: User {account_id} has plan: {plan_id}")
                    return plan_id
                else:
                    # Default to free if no billing record found
                    logger.warning(f"No billing record found for user {account_id}, defaulting to free plan")
                    return 'free'
                    
        except Exception as e:
            logger.error(f"Error fetching user plan from database for {account_id}: {str(e)}")
            return 'free'  # Default fallback
    
    @staticmethod
    async def clear_user_plan_cache(account_id: str) -> bool:
        """
        Clear cached plan data for a user (useful when plan changes)
        
        Args:
            account_id: User's account ID
            
        Returns:
            bool: True if cache was cleared, False otherwise
        """
        try:
            cache_key = f"user_plan:{account_id}"
            result = await redis.delete(cache_key)
            logger.debug(f"🗑️ Cleared plan cache for user {account_id}")
            return bool(result)
        except Exception as e:
            logger.error(f"Error clearing plan cache for user {account_id}: {str(e)}")
            return False
    
    @staticmethod
    async def update_key_usage(account_id: str, key_source: KeySource) -> None:
        """
        Update usage tracking for the API key that was used
        
        Args:
            account_id: User's account ID
            key_source: Source of the key that was used
        """
        try:
            if key_source == "user_byok":
                # Update last_used_at for user's BYOK key
                await OpenRouterKeyManager.update_last_used(account_id)
                logger.debug(f"Updated last_used_at for BYOK key for user {account_id}")
            # For system keys, we don't need to track individual usage
            
        except Exception as e:
            logger.error(f"Error updating key usage for user {account_id}: {str(e)}")
    
    @staticmethod
    async def validate_user_can_use_byok(account_id: str) -> Tuple[bool, Optional[str]]:
        """
        Check if user can use BYOK functionality
        
        Args:
            account_id: User's account ID
            
        Returns:
            Tuple of (can_use_byok, error_message)
        """
        try:
            user_plan = await APIKeyResolver.get_user_plan_cached(account_id)
            
            if user_plan != 'byok':
                return False, f"BYOK functionality requires upgrade to BYOK plan. Current plan: {user_plan}"
            
            return True, None
            
        except Exception as e:
            error_msg = f"Error validating BYOK access for user {account_id}: {str(e)}"
            logger.error(error_msg)
            return False, error_msg