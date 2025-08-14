"""
OpenRouter Pricing Service

Handles real-time pricing calculations for BYOK users using OpenRouter API rates.
Enhanced with Redis caching for optimal performance.
"""

import json
from typing import Dict, Optional
from utils.logger import logger
import aiohttp
from services import redis

# Cache configuration
OPENROUTER_CACHE_KEY = "openrouter:models:pricing"
CACHE_TTL_HOURS = 6  # 6 hours TTL for model pricing data
CACHE_TTL_SECONDS = CACHE_TTL_HOURS * 3600


class OpenRouterPricing:
    """Service for getting real OpenRouter pricing information with Redis caching"""
    
    @staticmethod
    async def get_model_pricing(model_name: str, api_key: str) -> Dict[str, float]:
        """
        Get pricing information for a specific model from OpenRouter (with caching)
        
        Args:
            model_name: The model name (e.g., 'anthropic/claude-sonnet-4')
            api_key: User's OpenRouter API key
            
        Returns:
            Dict with 'prompt_tokens_per_dollar' and 'completion_tokens_per_dollar'
        """
        try:
            # Clean up model name - remove 'openrouter/' prefix if present
            clean_model_name = model_name.replace('openrouter/', '') if model_name.startswith('openrouter/') else model_name
            
            # 🚀 CACHE OPTIMIZATION: Try Redis cache first
            cached_models = await OpenRouterPricing._get_cached_models()
            if cached_models:
                logger.debug(f"✅ Cache HIT: Using cached OpenRouter pricing for {clean_model_name}")
                pricing_info = OpenRouterPricing._extract_model_pricing(cached_models, clean_model_name)
                if pricing_info:
                    return pricing_info
                # Model not in cache, fall through to API call
                logger.debug(f"Model {clean_model_name} not found in cached data, fetching fresh data")
            else:
                logger.debug(f"❌ Cache MISS: Fetching fresh OpenRouter pricing for {clean_model_name}")
            
            # Cache miss or model not found - fetch from API and cache result
            models_data = await OpenRouterPricing._fetch_openrouter_models(api_key)
            if models_data:
                # 💾 Cache the fresh data for future requests
                await OpenRouterPricing._cache_models_data(models_data)
                
                # Extract pricing for the requested model
                pricing_info = OpenRouterPricing._extract_model_pricing(models_data, clean_model_name)
                if pricing_info:
                    return pricing_info
            
            # Model not found or API error, return default pricing
            logger.warning(f"Model {clean_model_name} not found in OpenRouter pricing")
            return OpenRouterPricing._get_default_pricing()
                        
        except Exception as e:
            logger.error(f"Error getting OpenRouter pricing for {model_name}: {str(e)}")
            return OpenRouterPricing._get_default_pricing()
    
    @staticmethod
    async def _get_cached_models() -> Optional[Dict]:
        """
        Get cached models data from Redis
        
        Returns:
            Cached models data or None if cache miss/error
        """
        try:
            cached_data = await redis.get(OPENROUTER_CACHE_KEY)
            if cached_data:
                return json.loads(cached_data)
            return None
        except Exception as e:
            logger.warning(f"Redis cache read error (graceful fallback to API): {str(e)}")
            return None
    
    @staticmethod
    async def _cache_models_data(models_data: Dict) -> None:
        """
        Cache models data in Redis with TTL
        
        Args:
            models_data: The models data to cache
        """
        try:
            await redis.set(
                OPENROUTER_CACHE_KEY, 
                json.dumps(models_data), 
                ex=CACHE_TTL_SECONDS
            )
            logger.info(f"💾 Cached OpenRouter models data for {CACHE_TTL_HOURS} hours")
        except Exception as e:
            logger.warning(f"Redis cache write error (non-critical): {str(e)}")
    
    @staticmethod
    async def _fetch_openrouter_models(api_key: str) -> Optional[Dict]:
        """
        Fetch models data from OpenRouter API
        
        Args:
            api_key: User's OpenRouter API key
            
        Returns:
            Models data from API or None on error
        """
        try:
            url = "https://openrouter.ai/api/v1/models"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=10) as response:
                    if response.status == 200:
                        data = await response.json()
                        logger.debug(f"📡 Fetched {len(data.get('data', []))} models from OpenRouter API")
                        return data
                    else:
                        logger.error(f"OpenRouter API error: {response.status}")
                        return None
        except Exception as e:
            logger.error(f"Error fetching OpenRouter models: {str(e)}")
            return None
    
    @staticmethod
    def _extract_model_pricing(models_data: Dict, clean_model_name: str) -> Optional[Dict[str, float]]:
        """
        Extract pricing information for a specific model from models data
        
        Args:
            models_data: The models data (from cache or API)
            clean_model_name: The clean model name to search for
            
        Returns:
            Pricing information dict or None if model not found
        """
        try:
            models = models_data.get('data', [])
            
            # Find the specific model
            for model in models:
                if model.get('id') == clean_model_name:
                    pricing = model.get('pricing', {})
                    prompt_price = float(pricing.get('prompt', 0))  # Price per token
                    completion_price = float(pricing.get('completion', 0))  # Price per token
                    
                    # Convert to tokens per dollar for easier calculation
                    prompt_tokens_per_dollar = 1 / prompt_price if prompt_price > 0 else 0
                    completion_tokens_per_dollar = 1 / completion_price if completion_price > 0 else 0
                    
                    return {
                        'prompt_tokens_per_dollar': prompt_tokens_per_dollar,
                        'completion_tokens_per_dollar': completion_tokens_per_dollar,
                        'prompt_price_per_token': prompt_price,
                        'completion_price_per_token': completion_price
                    }
            
            return None  # Model not found
            
        except Exception as e:
            logger.error(f"Error extracting model pricing: {str(e)}")
            return None
    
    @staticmethod
    def _get_default_pricing() -> Dict[str, float]:
        """Default pricing when OpenRouter API is unavailable"""
        # Conservative estimate: ~$0.000001 per token (1 million tokens per dollar)
        return {
            'prompt_tokens_per_dollar': 1000000,
            'completion_tokens_per_dollar': 500000,  # Completion usually costs more
            'prompt_price_per_token': 0.000001,
            'completion_price_per_token': 0.000002
        }
    
    @staticmethod
    def calculate_real_cost(
        prompt_tokens: int, 
        completion_tokens: int, 
        pricing_info: Dict[str, float]
    ) -> float:
        """
        Calculate real cost based on OpenRouter pricing
        
        Args:
            prompt_tokens: Number of prompt tokens
            completion_tokens: Number of completion tokens
            pricing_info: Pricing information from get_model_pricing()
            
        Returns:
            Total cost in USD
        """
        try:
            prompt_cost = prompt_tokens * pricing_info.get('prompt_price_per_token', 0)
            completion_cost = completion_tokens * pricing_info.get('completion_price_per_token', 0)
            
            total_cost = prompt_cost + completion_cost
            return round(total_cost, 6)  # Round to 6 decimal places
            
        except Exception as e:
            logger.error(f"Error calculating real cost: {str(e)}")
            return 0.0
    
    @staticmethod
    async def estimate_cost_for_model(
        model_name: str, 
        total_tokens: int, 
        api_key: str,
        prompt_ratio: float = 0.7  # Assume 70% prompt, 30% completion
    ) -> float:
        """
        Estimate cost for a model based on total tokens
        
        Args:
            model_name: The model name
            total_tokens: Total number of tokens
            api_key: User's OpenRouter API key
            prompt_ratio: Ratio of prompt to total tokens
            
        Returns:
            Estimated cost in USD
        """
        try:
            pricing_info = await OpenRouterPricing.get_model_pricing(model_name, api_key)
            
            prompt_tokens = int(total_tokens * prompt_ratio)
            completion_tokens = total_tokens - prompt_tokens
            
            return OpenRouterPricing.calculate_real_cost(
                prompt_tokens, 
                completion_tokens, 
                pricing_info
            )
            
        except Exception as e:
            logger.error(f"Error estimating cost for {model_name}: {str(e)}")
            return 0.0
    
    @staticmethod
    async def warm_cache(api_key: str) -> bool:
        """
        Manually warm the cache by fetching fresh pricing data
        
        Args:
            api_key: Valid OpenRouter API key to use for fetching
            
        Returns:
            True if cache was successfully warmed, False otherwise
        """
        try:
            logger.info("🔥 Warming OpenRouter pricing cache...")
            models_data = await OpenRouterPricing._fetch_openrouter_models(api_key)
            if models_data:
                await OpenRouterPricing._cache_models_data(models_data)
                model_count = len(models_data.get('data', []))
                logger.info(f"✅ Cache warmed successfully with {model_count} models")
                return True
            else:
                logger.warning("❌ Failed to warm cache - no data from OpenRouter API")
                return False
        except Exception as e:
            logger.error(f"❌ Error warming cache: {str(e)}")
            return False
    
    @staticmethod
    async def clear_cache() -> bool:
        """
        Clear the OpenRouter pricing cache
        
        Returns:
            True if cache was cleared successfully, False otherwise
        """
        try:
            result = await redis.delete(OPENROUTER_CACHE_KEY)
            logger.info(f"🗑️ OpenRouter pricing cache cleared (deleted: {result})")
            return bool(result)
        except Exception as e:
            logger.error(f"Error clearing cache: {str(e)}")
            return False
    
    @staticmethod
    async def get_cache_info() -> Dict[str, any]:
        """
        Get information about the current cache state
        
        Returns:
            Dict with cache information
        """
        try:
            cached_data = await redis.get(OPENROUTER_CACHE_KEY)
            if cached_data:
                models_data = json.loads(cached_data)
                model_count = len(models_data.get('data', []))
                
                # Get TTL information
                ttl = await redis.get_client()
                ttl_result = await ttl.ttl(OPENROUTER_CACHE_KEY)
                
                return {
                    'cached': True,
                    'model_count': model_count,
                    'ttl_seconds': ttl_result,
                    'ttl_hours': round(ttl_result / 3600, 2) if ttl_result > 0 else 0,
                    'cache_key': OPENROUTER_CACHE_KEY
                }
            else:
                return {
                    'cached': False,
                    'model_count': 0,
                    'ttl_seconds': 0,
                    'ttl_hours': 0,
                    'cache_key': OPENROUTER_CACHE_KEY
                }
        except Exception as e:
            logger.error(f"Error getting cache info: {str(e)}")
            return {
                'cached': False,
                'error': str(e),
                'cache_key': OPENROUTER_CACHE_KEY
            }