"""
Token-based billing system with credit abstraction for user-facing display.
Completely rewritten to remove Stripe dependency and use database-first approach.
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Optional, Dict, List
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from supabase import Client

from utils.logger import logger
from services.supabase import DBConnection
from utils.auth_utils import get_current_user_id_from_jwt
from utils.payment_methods import (
    get_payment_methods_by_region, 
    detect_country_from_request,
    validate_payment_methods,
    get_supported_regions,
    get_all_payment_methods,
    get_payment_preset,
    PAYMENT_PRESETS,
    RegionCode
)
from utils.constants import PLANS, get_plan_by_id, get_credits_from_tokens, get_tokens_from_credits
from services.token_billing import (
    get_user_token_status, 
    get_token_usage_history,
    InsufficientTokensError
)
from services.polar_service import create_polar_checkout_session

# Initialize router
router = APIRouter(prefix="/billing", tags=["billing"])

# Import BYOK services
from services.user_openrouter_keys import OpenRouterKeyManager
from services.api_key_resolver import APIKeyResolver
from services.openrouter_pricing import OpenRouterPricing

# Request/Response models
class SubscriptionStatusResponse(BaseModel):
    account_id: str
    plan_id: str
    plan_name: str
    price_inr: int
    price_usd: int
    tokens_total: int
    tokens_remaining: int
    credits_total: int
    credits_remaining: int
    quota_resets_at: str
    subscription_status: str = "active"
    features: List[str]
    deployments_used: int = 0
    deployments_total: int = 0
    
class UsageHistoryResponse(BaseModel):
    account_id: str
    usage_entries: List[Dict]
    total_tokens_used: int
    total_credits_used: int

# BYOK Request/Response models
class StoreOpenRouterKeyRequest(BaseModel):
    api_key: str
    display_name: str = "OpenRouter API Key"

class OpenRouterKeyStatusResponse(BaseModel):
    has_key: bool
    key_configured: bool
    display_name: Optional[str] = None
    last_used_at: Optional[str] = None
    created_at: Optional[str] = None
    error: Optional[str] = None

class TestOpenRouterKeyRequest(BaseModel):
    api_key: str

class TestOpenRouterKeyResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    error: Optional[str] = None
    
class CreateCheckoutSessionRequest(BaseModel):
    plan_id: str  # 'free', 'pro', 'premium', 'byok'
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    allowed_payment_methods: Optional[List[str]] = None  # Restrict payment methods
    country_code: Optional[str] = None  # ISO country code for region-based payment methods
    use_regional_defaults: bool = True  # Auto-detect and use regional payment methods

class CheckoutSessionResponse(BaseModel):
    checkout_url: Optional[str] = None
    success: bool
    message: str
    plan_details: Optional[Dict] = None

class PlanUpgradeRequest(BaseModel):
    new_plan_id: str

class PlanListResponse(BaseModel):
    plans: List[Dict]
    current_plan: str



# calculate_token_cost moved to utils.constants to avoid circular imports

async def get_user_subscription(user_id: str) -> Optional[Dict]:
    """Get user subscription information from database."""
    try:
        from services import redis as redis_service

        db = DBConnection()
        async with db.get_async_client() as client:
            # Get account_id from Clerk user (with Redis caching for performance)
            account_id = await redis_service.get_account_id_cached(client, user_id)
            if not account_id:
                return None

            return await get_user_token_status(client, account_id)

    except Exception as e:
        logger.error(f"Error fetching user subscription: {str(e)}")
        return None



# API Endpoints

@router.get("/status", response_model=SubscriptionStatusResponse)
async def get_billing_status(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get current billing status and quota information."""
    try:
        subscription = await get_user_subscription(current_user_id)
        if not subscription:
            # Graceful fallback: return default free plan for users without billing records
            logger.info(f"No subscription found for user {current_user_id}, returning default free plan")
            
            # Get account_id for the user
            db = DBConnection()
            async with db.get_async_client() as client:
                account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': current_user_id}).execute()
                if not account_result.data:
                    raise HTTPException(status_code=404, detail="User account not found")
                account_id = account_result.data
            
            # Return default free plan
            free_plan = get_plan_by_id('free')
            free_tokens = free_plan['token_quota']
            free_credits = free_plan['display_credits']
            
            # Get deployment count
            from deployments.api import _count_deployed_projects_for_account, _max_deployed_for_plan
            async with db.get_async_client() as client:
                deployments_used = await _count_deployed_projects_for_account(client, account_id)
            deployments_total = _max_deployed_for_plan('free')
            
            return SubscriptionStatusResponse(
                account_id=account_id,
                plan_id='free',
                plan_name=free_plan['name'],
                price_inr=free_plan['price_inr'],
                price_usd=free_plan['price_usd'],
                tokens_total=free_tokens,
                tokens_remaining=free_tokens,
                credits_total=free_credits,
                credits_remaining=free_credits,
                quota_resets_at=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
                features=free_plan['features'],
                deployments_used=deployments_used,
                deployments_total=deployments_total
            )
            
        plan_config = get_plan_by_id(subscription['plan'])
        if not plan_config:
            raise HTTPException(status_code=500, detail="Invalid plan configuration")
            
        # Get deployment count
        from deployments.api import _count_deployed_projects_for_account, _max_deployed_for_plan
        db = DBConnection()
        async with db.get_async_client() as client:
            deployments_used = await _count_deployed_projects_for_account(client, subscription['account_id'])
        deployments_total = _max_deployed_for_plan(subscription['plan'])
        
        return SubscriptionStatusResponse(
            account_id=subscription['account_id'],
            plan_id=subscription['plan'],
            plan_name=plan_config['name'],
            price_inr=plan_config['price_inr'],
            price_usd=plan_config['price_usd'],
            tokens_total=subscription['tokens_total'],
            tokens_remaining=subscription['tokens_remaining'],
            credits_total=subscription['credits_total'],
            credits_remaining=subscription['credits_remaining'],
            quota_resets_at=subscription['quota_resets_at'],
            features=plan_config['features'],
            deployments_used=deployments_used,
            deployments_total=deployments_total
        )
        
    except Exception as e:
        logger.error(f"Error getting billing status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving billing status: {str(e)}")

@router.get("/subscription", response_model=SubscriptionStatusResponse)
async def get_subscription_status(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get subscription status - alias for /status endpoint for frontend compatibility."""
    return await get_billing_status(current_user_id)



@router.get("/usage-history", response_model=UsageHistoryResponse)
async def get_usage_history(
    days: int = 30,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get token usage history for the user."""
    try:
        db = DBConnection()
        async with db.get_async_client() as client:
            # Get account_id from Clerk user
            account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': current_user_id}).execute()
            if not account_result.data:
                raise HTTPException(status_code=404, detail="User account not found")
                
            account_id = account_result.data
            usage_history = await get_token_usage_history(client, account_id, days=days)
            
            total_tokens = sum(entry['total_tokens'] for entry in usage_history)
            total_credits = get_credits_from_tokens(total_tokens)
            
            return UsageHistoryResponse(
                account_id=account_id,
                usage_entries=usage_history,
                total_tokens_used=total_tokens,
                total_credits_used=total_credits
            )
            
    except Exception as e:
        logger.error(f"Error getting usage history: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving usage history: {str(e)}")

@router.get("/plans", response_model=PlanListResponse)
async def get_available_plans(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get list of available subscription plans."""
    try:
        subscription = await get_user_subscription(current_user_id)
        current_plan = subscription['plan'] if subscription else 'free'
        
        return PlanListResponse(
            plans=list(PLANS.values()),
            current_plan=current_plan
        )
        
    except Exception as e:
        logger.error(f"Error getting plans: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving plans: {str(e)}")

@router.post("/create-checkout-session", response_model=CheckoutSessionResponse)
async def create_checkout_session(
    request: CreateCheckoutSessionRequest,
    http_request: Request,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Create Polar checkout session for plan upgrade."""
    try:
        plan_config = get_plan_by_id(request.plan_id)
        if not plan_config:
            raise HTTPException(status_code=400, detail="Invalid plan ID")
            
        # For Free plan, no payment needed
        if request.plan_id == 'free':
            return CheckoutSessionResponse(
                checkout_url=None,
                success=True,
                message="Free plan activated successfully",
                plan_details=plan_config
            )
            
        # For paid plans, create Polar checkout session
        try:
            
            db = DBConnection()
            async with db.get_async_client() as client:
                # Get account_id from Clerk user
                account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': current_user_id}).execute()
                if not account_result.data:
                    raise HTTPException(status_code=404, detail="User account not found")
                    
                account_id = account_result.data
                
                # Get user info for customer creation from users table
                user_result = await client.table('users').select('*').eq('id', account_id).execute()
                if not user_result.data:
                    raise HTTPException(status_code=404, detail="User not found")

                user_data = user_result.data[0]
                user_email = user_data.get('email')
                
                # Email should already be populated during signup
                if not user_email or 'placeholder' in user_email or 'missing_email' in user_email:
                    logger.error(f"User {account_id} has invalid email in billing_customers table: {user_email}")
                    raise HTTPException(
                        status_code=400, 
                        detail="Your account is missing a valid email address. Please contact support."
                    )
                
                # Determine payment methods based on region and user preferences
                final_payment_methods = request.allowed_payment_methods
                
                # Auto-detect user's country from request headers or use provided country
                detected_country = request.country_code or detect_country_from_request(dict(http_request.headers))
                
                if request.use_regional_defaults and not final_payment_methods:
                    if detected_country:
                        # Get region-appropriate payment methods (subscription-safe)
                        final_payment_methods = get_payment_methods_by_region(
                            country_code=detected_country,
                            is_subscription=True  # All plan upgrades are subscriptions
                        )
                        logger.info(f"Using regional payment methods for {detected_country}: {final_payment_methods}")
                    else:
                        # Fallback to subscription-safe default methods
                        final_payment_methods = get_payment_methods_by_region(
                            country_code=RegionCode.DEFAULT.value,
                            is_subscription=True
                        )
                        logger.info(f"Using default payment methods: {final_payment_methods}")
                
                # Validate payment methods if explicitly provided
                if request.allowed_payment_methods:
                    validation = validate_payment_methods(
                        methods=request.allowed_payment_methods,
                        country_code=detected_country or RegionCode.DEFAULT.value,
                        is_subscription=True
                    )
                    if not validation["valid"]:
                        logger.warning(f"Invalid payment methods provided: {validation['unsupported_methods']}")
                        # Use only supported methods
                        final_payment_methods = validation["supported_methods"]
                
                # Validate email before calling checkout
                if not user_email or '@' not in user_email:
                    raise HTTPException(
                        status_code=400, 
                        detail="Your account needs a valid email address to proceed with checkout. Please update your profile."
                    )
                
                checkout_url = await create_polar_checkout_session(
                    plan_id=request.plan_id,
                    account_id=account_id,
                    user_email=user_email,
                    user_name=user_data.get('name', ''),
                    success_url=request.success_url,
                    cancel_url=request.cancel_url,
                    allowed_payment_methods=final_payment_methods
                )
                
                return CheckoutSessionResponse(
                    checkout_url=checkout_url,
                    success=True,
                    message="Checkout session created successfully",
                    plan_details=plan_config
                )
                
        except Exception as e:
            logger.error(f"Error creating checkout session: {str(e)}")
            error_message = str(e)

            # Handle specific error types from the Polar SDK
            if "Payment processing is currently unavailable" in error_message:
                raise HTTPException(status_code=503, detail=error_message)
            elif "Invalid plan_id" in error_message or "Unknown plan" in error_message:
                raise HTTPException(status_code=400, detail=error_message)
            else:
                raise HTTPException(status_code=500, detail="Failed to create checkout session. Please try again.")
        
    except Exception as e:
        logger.error(f"Unexpected error in checkout session creation: {str(e)}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred. Please try again.")

@router.post("/upgrade-plan")
async def upgrade_plan(
    request: PlanUpgradeRequest,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Direct plan upgrade for free tiers or admin actions."""
    try:
        plan_config = get_plan_by_id(request.new_plan_id)
        if not plan_config:
            raise HTTPException(status_code=400, detail="Invalid plan ID")
            
        db = DBConnection()
        async with db.get_async_client() as client:
            # Get account_id from Clerk user
            account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': current_user_id}).execute()
            if not account_result.data:
                raise HTTPException(status_code=404, detail="User account not found")
                
            account_id = account_result.data
            
            # Update user's plan and quota
            new_quota_reset = datetime.now(timezone.utc) + timedelta(days=30)

            await client.table('users').update({
                'plan_id': request.new_plan_id,
                'token_quota_total': plan_config['token_quota'],
                'token_quota_remaining': plan_config['token_quota'],
                'quota_resets_at': new_quota_reset.isoformat(),
                'billing_updated_at': datetime.now(timezone.utc).isoformat()
            }).eq('id', account_id).execute()
            
            logger.info(f"✅ Upgraded account {account_id} to {request.new_plan_id} plan")

            # Invalidate billing cache after plan upgrade
            await invalidate_billing_cache(account_id)

            return {
                "success": True,
                "message": f"Successfully upgraded to {plan_config['name']} plan",
                "new_plan": plan_config,
                "quota_reset_date": new_quota_reset.isoformat()
            }
        
    except Exception as e:
        logger.error(f"Error upgrading plan: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error upgrading plan: {str(e)}")

@router.post("/webhook/success")
async def handle_payment_success(
    request: Dict,
    background_tasks=None
):
    """Handle successful payment webhook (legacy endpoint)."""
    try:
        # Note: Primary webhook handling is in api/webhooks/polar.py
        logger.info("Payment success webhook received")
        return {"status": "ok"}

    except Exception as e:
        logger.error(f"Error handling payment success: {str(e)}")
        raise HTTPException(status_code=500, detail="Error processing payment success")

@router.post("/admin/reset-quotas")
async def manual_quota_reset(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Manually trigger quota reset for testing purposes."""
    try:
        # Note: In production, this should have admin-only access control
        db = DBConnection()
        async with db.get_async_client() as client:
            # Call the quota reset function
            result = await client.rpc('check_and_reset_quotas').execute()
        
            if result.data:
                reset_info = result.data
                logger.info(f"Manual quota reset completed. Processed {len(reset_info)} accounts")
                return {
                    "success": True,
                    "message": f"Quota reset completed for {len(reset_info)} accounts",
                    "reset_details": reset_info
                }
            else:
                return {
                    "success": True,
                    "message": "No accounts needed quota reset",
                    "reset_details": []
                }
        
    except Exception as e:
        logger.error(f"Error in manual quota reset: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error resetting quotas: {str(e)}")

@router.get("/admin/quota-status")  
async def get_quota_status(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get quota status for all users (admin endpoint)."""
    try:
        # Note: In production, this should have admin-only access control
        db = DBConnection()
        async with db.get_async_client() as client:
            # Get quota status for all users
            result = await client.table('users').select(
                'id, plan_id, token_quota_total, token_quota_remaining, quota_resets_at'
            ).execute()
            
            if result.data:
                # Add credits information
                quota_info = []
                for customer in result.data:
                    plan_config = get_plan_by_id(customer['plan_id'])
                    credits_remaining = get_credits_from_tokens(customer['token_quota_remaining']) if customer['token_quota_remaining'] > 0 else 0
                    credits_total = plan_config['display_credits'] if plan_config else 0
                    
                    quota_info.append({
                        **customer,
                        'credits_total': credits_total,
                        'credits_remaining': credits_remaining,
                        'plan_name': plan_config['name'] if plan_config else 'Unknown',
                        'needs_reset': customer['quota_resets_at'] <= datetime.now(timezone.utc).isoformat()
                })
            
                return {
                    "success": True,
                    "quota_status": quota_info,
                    "total_users": len(quota_info)
                }
            else:
                return {
                    "success": True,
                    "quota_status": [],
                    "total_users": 0
                }
                
    except Exception as e:
        logger.error(f"Error getting quota status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving quota status: {str(e)}")

# Legacy compatibility functions (for existing code)
# Billing status cache TTL in seconds (30 seconds for quick updates while reducing DB load)
BILLING_STATUS_CACHE_TTL = 30

async def can_use_model(client: Client, user_id: str, model_name: str):
    """Check if user can use a specific model based on their subscription.

    Uses Redis caching with short TTL to reduce database load while maintaining
    reasonable accuracy for billing status checks.
    """
    import json
    from services import redis as redis_service

    try:
        # Get account_id from Clerk user
        account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': user_id}).execute()
        if not account_result.data:
            return False, "User account not found", {}

        account_id = account_result.data
        cache_key = f"billing_status:{account_id}"

        # Try to get from cache first
        try:
            cached_status = await redis_service.get_value(cache_key)
            if cached_status:
                token_status = json.loads(cached_status)
                logger.debug(f"Cache HIT for billing status: {account_id}")

                # Check cached token status
                min_tokens_needed = 1000

                if token_status.get('plan') == 'byok':
                    return True, "BYOK plan - model access allowed", token_status

                if token_status.get('tokens_remaining', 0) < min_tokens_needed:
                    return False, f"Insufficient credits. You have {token_status.get('credits_remaining', 0)} credits remaining. Please upgrade your plan.", token_status

                return True, "Model access allowed", token_status
        except Exception as cache_error:
            logger.debug(f"Cache miss or error for {account_id}: {str(cache_error)}")

        # Cache miss - fetch from database
        token_status = await get_user_token_status(client, account_id)

        # Cache the result
        try:
            await redis_service.set_value(
                cache_key,
                json.dumps(token_status),
                ttl=BILLING_STATUS_CACHE_TTL
            )
            logger.debug(f"Cached billing status for {account_id}")
        except Exception as cache_set_error:
            logger.warning(f"Failed to cache billing status: {str(cache_set_error)}")

        # Check if user has sufficient tokens for a conversation
        min_tokens_needed = 1000  # Minimum tokens needed for model usage

        if token_status['plan'] == 'byok':
            return True, "BYOK plan - model access allowed", token_status

        if token_status['tokens_remaining'] < min_tokens_needed:
            return False, f"Insufficient credits. You have {token_status['credits_remaining']} credits remaining. Please upgrade your plan.", token_status

        return True, "Model access allowed", token_status

    except Exception as e:
        logger.error(f"Error checking model access: {str(e)}")
        return False, f"Error checking model access: {str(e)}", {}


async def invalidate_billing_cache(account_id: str):
    """Invalidate the billing status cache for an account.

    Call this after token consumption or plan changes to ensure fresh data.
    """
    from services import redis as redis_service

    try:
        cache_key = f"billing_status:{account_id}"
        await redis_service.delete_key(cache_key)
        logger.debug(f"Invalidated billing cache for {account_id}")
    except Exception as e:
        logger.warning(f"Failed to invalidate billing cache: {str(e)}")

async def check_billing_status(client: Client, user_id: str):
    """Check if user can run agents based on their subscription and usage."""
    try:
        can_use, message, subscription_info = await can_use_model(client, user_id, "default")
        return can_use, message, subscription_info
        
    except Exception as e:
        logger.error(f"Error checking billing status: {str(e)}")
        return False, f"Error checking billing status: {str(e)}", {}

# === Payment Methods Configuration Endpoints ===

@router.get("/payment-methods/regions")
async def get_regions():
    """Get all supported regions for payment method configuration."""
    try:
        return {
            "success": True,
            "regions": get_supported_regions()
        }
    except Exception as e:
        logger.error(f"Error getting supported regions: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving supported regions: {str(e)}")

@router.get("/payment-methods/all")
async def get_payment_methods():
    """Get all available payment methods."""
    try:
        return {
            "success": True,
            "payment_methods": get_all_payment_methods()
        }
    except Exception as e:
        logger.error(f"Error getting payment methods: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving payment methods: {str(e)}")

@router.get("/payment-methods/region/{country_code}")
async def get_payment_methods_for_region(
    country_code: str,
    is_subscription: bool = True
):
    """Get available payment methods for a specific region."""
    try:
        methods = get_payment_methods_by_region(
            country_code=country_code.upper(),
            is_subscription=is_subscription
        )
        
        return {
            "success": True,
            "country_code": country_code.upper(),
            "is_subscription": is_subscription,
            "payment_methods": methods
        }
    except Exception as e:
        logger.error(f"Error getting payment methods for region {country_code}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving payment methods: {str(e)}")

@router.post("/payment-methods/validate")
async def validate_payment_methods_endpoint(
    country_code: str,
    payment_methods: List[str],
    is_subscription: bool = True
):
    """Validate payment methods for a specific region and transaction type."""
    try:
        validation = validate_payment_methods(
            methods=payment_methods,
            country_code=country_code.upper(),
            is_subscription=is_subscription
        )
        
        return {
            "success": True,
            "validation": validation,
            "country_code": country_code.upper(),
            "is_subscription": is_subscription
        }
    except Exception as e:
        logger.error(f"Error validating payment methods: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error validating payment methods: {str(e)}")

@router.get("/payment-methods/presets")
async def get_payment_presets():
    """Get predefined payment method configurations."""
    try:
        return {
            "success": True,
            "presets": {
                name: {
                    "name": name.replace("_", " ").title(),
                    "methods": methods
                }
                for name, methods in PAYMENT_PRESETS.items()
            }
        }
    except Exception as e:
        logger.error(f"Error getting payment presets: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving payment presets: {str(e)}")

@router.get("/payment-methods/detect")
async def detect_user_region(http_request: Request):
    """Detect user's region from request headers."""
    try:
        detected_country = detect_country_from_request(dict(http_request.headers))
        
        if detected_country:
            # Get payment methods for detected region
            payment_methods = get_payment_methods_by_region(
                country_code=detected_country,
                is_subscription=True
            )
            
            return {
                "success": True,
                "detected_country": detected_country,
                "payment_methods": payment_methods,
                "detection_headers": [key for key in http_request.headers.keys() if 'country' in key.lower()]
            }
        else:
            return {
                "success": True,
                "detected_country": None,
                "payment_methods": get_payment_methods_by_region(RegionCode.DEFAULT.value, True),
                "message": "Could not detect country from headers, using default methods"
            }
    except Exception as e:
        logger.error(f"Error detecting user region: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error detecting region: {str(e)}")

# BYOK OpenRouter API Key Management Endpoints

@router.post("/openrouter-key", response_model=dict)
async def store_openrouter_key(
    request: StoreOpenRouterKeyRequest,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Store user's OpenRouter API key for BYOK functionality"""
    try:
        # Get account_id for the user
        db = DBConnection()
        async with db.get_async_client() as client:
            account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': current_user_id}).execute()
            if not account_result.data:
                raise HTTPException(status_code=404, detail="User account not found")
            account_id = account_result.data
        
        # Validate user can use BYOK
        can_use_byok, error_msg = await APIKeyResolver.validate_user_can_use_byok(account_id)
        if not can_use_byok:
            raise HTTPException(status_code=403, detail=error_msg)
        
        # Test the API key before storing
        test_result = await OpenRouterKeyManager.test_api_key_connection(request.api_key)
        if not test_result["success"]:
            raise HTTPException(status_code=400, detail=f"API key validation failed: {test_result['error']}")
        
        # Store the API key
        key_id = await OpenRouterKeyManager.store_api_key(
            account_id=account_id,
            api_key=request.api_key,
            display_name=request.display_name
        )
        
        return {
            "success": True,
            "message": "OpenRouter API key stored successfully",
            "key_id": key_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error storing OpenRouter API key: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error storing API key: {str(e)}")

@router.get("/openrouter-key/status", response_model=OpenRouterKeyStatusResponse)
async def get_openrouter_key_status(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get status of user's OpenRouter API key"""
    try:
        # Get account_id for the user
        db = DBConnection()
        async with db.get_async_client() as client:
            account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': current_user_id}).execute()
            if not account_result.data:
                raise HTTPException(status_code=404, detail="User account not found")
            account_id = account_result.data
        
        # Validate user can use BYOK
        can_use_byok, error_msg = await APIKeyResolver.validate_user_can_use_byok(account_id)
        if not can_use_byok:
            raise HTTPException(status_code=403, detail=error_msg)
        
        # Get key information
        key_info = await OpenRouterKeyManager.get_key_info(account_id)
        
        if key_info:
            return OpenRouterKeyStatusResponse(
                has_key=True,
                key_configured=key_info.is_active,
                display_name=key_info.display_name,
                last_used_at=key_info.last_used_at.isoformat() if key_info.last_used_at else None,
                created_at=key_info.created_at.isoformat()
            )
        else:
            return OpenRouterKeyStatusResponse(
                has_key=False,
                key_configured=False
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting OpenRouter key status: {str(e)}")
        return OpenRouterKeyStatusResponse(
            has_key=False,
            key_configured=False,
            error=f"Error retrieving key status: {str(e)}"
        )

@router.delete("/openrouter-key")
async def delete_openrouter_key(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Delete user's OpenRouter API key"""
    try:
        # Get account_id for the user
        db = DBConnection()
        async with db.get_async_client() as client:
            account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': current_user_id}).execute()
            if not account_result.data:
                raise HTTPException(status_code=404, detail="User account not found")
            account_id = account_result.data
        
        # Validate user can use BYOK
        can_use_byok, error_msg = await APIKeyResolver.validate_user_can_use_byok(account_id)
        if not can_use_byok:
            raise HTTPException(status_code=403, detail=error_msg)
        
        # Delete the API key
        success = await OpenRouterKeyManager.delete_api_key(account_id)
        
        if success:
            return {"success": True, "message": "OpenRouter API key deleted successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to delete API key")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting OpenRouter API key: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error deleting API key: {str(e)}")

@router.post("/openrouter-key/test", response_model=TestOpenRouterKeyResponse)
async def test_openrouter_key(
    request: TestOpenRouterKeyRequest,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Test OpenRouter API key connection"""
    try:
        # Get account_id for the user
        db = DBConnection()
        async with db.get_async_client() as client:
            account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': current_user_id}).execute()
            if not account_result.data:
                raise HTTPException(status_code=404, detail="User account not found")
            account_id = account_result.data
        
        # Validate user can use BYOK
        can_use_byok, error_msg = await APIKeyResolver.validate_user_can_use_byok(account_id)
        if not can_use_byok:
            raise HTTPException(status_code=403, detail=error_msg)
        
        # Test the API key
        test_result = await OpenRouterKeyManager.test_api_key_connection(request.api_key)
        
        return TestOpenRouterKeyResponse(
            success=test_result["success"],
            message=test_result.get("message"),
            error=test_result.get("error")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error testing OpenRouter API key: {str(e)}")
        return TestOpenRouterKeyResponse(
            success=False,
            error=f"Error testing API key: {str(e)}"
        )


# ============================================================================
# ADMIN ENDPOINTS - OpenRouter Pricing Cache Management
# ============================================================================

class CacheInfoResponse(BaseModel):
    cached: bool
    model_count: int
    ttl_seconds: int
    ttl_hours: float
    cache_key: str
    error: Optional[str] = None

class CacheOperationResponse(BaseModel):
    success: bool
    message: str
    error: Optional[str] = None

@router.get("/admin/openrouter-cache/info", response_model=CacheInfoResponse)
async def get_openrouter_cache_info(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get OpenRouter pricing cache information (Admin only)"""
    try:
        # TODO: Add proper admin authorization check here
        # For now, allowing any authenticated user for development
        
        cache_info = await OpenRouterPricing.get_cache_info()
        
        return CacheInfoResponse(
            cached=cache_info.get('cached', False),
            model_count=cache_info.get('model_count', 0),
            ttl_seconds=cache_info.get('ttl_seconds', 0),
            ttl_hours=cache_info.get('ttl_hours', 0),
            cache_key=cache_info.get('cache_key', ''),
            error=cache_info.get('error')
        )
        
    except Exception as e:
        logger.error(f"Error getting cache info: {str(e)}")
        return CacheInfoResponse(
            cached=False,
            model_count=0,
            ttl_seconds=0,
            ttl_hours=0,
            cache_key="",
            error=str(e)
        )

@router.post("/admin/openrouter-cache/warm", response_model=CacheOperationResponse)
async def warm_openrouter_cache(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Warm the OpenRouter pricing cache (Admin only)"""
    try:
        # TODO: Add proper admin authorization check here
        # For now, allowing any authenticated user for development
        
        # Use system OpenRouter API key for warming cache
        from utils.config import config
        system_api_key = config.OPENROUTER_API_KEY
        
        if not system_api_key:
            return CacheOperationResponse(
                success=False,
                message="System OpenRouter API key not configured",
                error="OPENROUTER_API_KEY environment variable not set"
            )
        
        success = await OpenRouterPricing.warm_cache(system_api_key)
        
        if success:
            return CacheOperationResponse(
                success=True,
                message="OpenRouter pricing cache warmed successfully"
            )
        else:
            return CacheOperationResponse(
                success=False,
                message="Failed to warm cache",
                error="Unable to fetch pricing data from OpenRouter API"
            )
        
    except Exception as e:
        logger.error(f"Error warming cache: {str(e)}")
        return CacheOperationResponse(
            success=False,
            message="Error warming cache",
            error=str(e)
        )

@router.post("/admin/openrouter-cache/clear", response_model=CacheOperationResponse)
async def clear_openrouter_cache(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Clear the OpenRouter pricing cache (Admin only)"""
    try:
        # TODO: Add proper admin authorization check here
        # For now, allowing any authenticated user for development
        
        success = await OpenRouterPricing.clear_cache()
        
        if success:
            return CacheOperationResponse(
                success=True,
                message="OpenRouter pricing cache cleared successfully"
            )
        else:
            return CacheOperationResponse(
                success=False,
                message="Cache was already empty or not found",
                error="No cache data to clear"
            )
        
    except Exception as e:
        logger.error(f"Error clearing cache: {str(e)}")
        return CacheOperationResponse(
            success=False,
            message="Error clearing cache",
            error=str(e)
        )

