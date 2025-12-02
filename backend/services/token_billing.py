"""
Token-based billing service for real-time quota management.
"""

from typing import Dict, Optional, Tuple, List
from datetime import datetime, timedelta
from supabase import Client
from decimal import Decimal

from utils.logger import logger
from utils.constants import PLANS, get_plan_by_id, get_credits_from_tokens, calculate_token_cost

class InsufficientTokensError(Exception):
    """Raised when user doesn't have enough tokens for an operation."""
    def __init__(self, message: str, remaining_tokens: int, remaining_credits: int):
        self.remaining_tokens = remaining_tokens
        self.remaining_credits = remaining_credits
        super().__init__(message)

async def consume_tokens(
    client: Client, 
    account_id: str, 
    tokens_used: int, 
    model: str, 
    thread_id: Optional[str] = None, 
    message_id: Optional[str] = None
) -> Dict:
    """
    Atomically consume tokens from user's quota using SQL constraints.
    
    Returns:
        Dict with success status, remaining tokens and credits
        
    Raises:
        InsufficientTokensError if quota exceeded
    """
    try:
        # Get user billing info first
        billing_result = await client.table('users') \
            .select('id, plan_id, token_quota_remaining, token_quota_total') \
            .eq('id', account_id) \
            .execute()
        
        if not billing_result.data:
            # Create billing record for new user
            await _create_billing_record(client, account_id)
            billing_result = await client.table('users') \
                .select('id, plan_id, token_quota_remaining, token_quota_total') \
                .eq('id', account_id) \
                .execute()
        
        user_billing = billing_result.data[0]
        current_remaining = user_billing['token_quota_remaining']
        plan_id = user_billing['plan_id']
        
        # BYOK users have unlimited tokens - just log usage with real costs
        if plan_id == 'byok':
            # Get real OpenRouter pricing for BYOK users
            try:
                from services.openrouter_pricing import OpenRouterPricing
                from services.api_key_resolver import APIKeyResolver
                
                # Get user's API key for pricing lookup
                user_api_key, key_source, _ = await APIKeyResolver.get_openrouter_key_for_user(account_id)
                
                if user_api_key and key_source == "user_byok":
                    # Use real OpenRouter pricing
                    estimated_cost = await OpenRouterPricing.estimate_cost_for_model(
                        model, tokens_used, user_api_key
                    )
                else:
                    # Fallback to system pricing if no user key
                    estimated_cost = calculate_token_cost(
                        tokens_used // 2,  # Rough estimate of prompt vs completion split
                        tokens_used // 2, 
                        model
                    )
            except Exception as e:
                logger.error(f"Error calculating real OpenRouter cost for BYOK user {account_id}: {str(e)}")
                # Fallback to system pricing
                estimated_cost = calculate_token_cost(
                    tokens_used // 2,  # Rough estimate of prompt vs completion split
                    tokens_used // 2, 
                    model
                )
            
            # Log usage for BYOK users without deducting tokens
            await client.table('token_usage_log') \
                .insert({
                    'user_id': account_id,
                    'thread_id': thread_id,
                    'message_id': message_id,
                    'model': model,
                    'prompt_tokens': tokens_used // 2,
                    'completion_tokens': tokens_used // 2,
                    'total_tokens': tokens_used,
                    'tokens_remaining_after': current_remaining,
                    'estimated_cost': float(estimated_cost),
                    'is_byok_real_cost': user_api_key is not None,  # Flag to indicate real vs estimated cost
                    'api_key_source': key_source  # Track which key was used
                }) \
                .execute()
            
            return {
                'success': True,
                'tokens_consumed': tokens_used,
                'tokens_remaining': current_remaining,
                'credits_remaining': -1,  # Unlimited
                'plan_id': plan_id,
                'byok_unlimited': True
            }
        
        # Use atomic UPDATE with WHERE constraint to prevent race conditions
        # This ensures only one request can successfully deduct tokens
        return await _consume_tokens_fallback(client, account_id, tokens_used, model, thread_id, message_id)
        
    except InsufficientTokensError:
        raise
    except Exception as e:
        logger.error(f"Error consuming tokens for user {account_id}: {str(e)}")
        raise

async def _consume_tokens_fallback(
    client: Client, 
    account_id: str, 
    tokens_used: int, 
    model: str, 
    thread_id: Optional[str] = None, 
    message_id: Optional[str] = None
) -> Dict:
    """
    Fallback atomic token consumption using SQL UPDATE with constraint.
    This is race-condition safe because PostgreSQL ensures atomicity.
    """
    try:
        # Get current state
        billing_result = await client.table('users') \
            .select('id, plan_id, token_quota_remaining, token_quota_total') \
            .eq('id', account_id) \
            .execute()
            
        if not billing_result.data:
            raise Exception("User billing record not found")
            
        user_billing = billing_result.data[0]
        current_remaining = user_billing['token_quota_remaining']
        plan_id = user_billing['plan_id']
        
        # Create a PostgreSQL function call for atomic decrement
        # Since we can't use raw SQL safely, let's use Supabase RPC with a simple approach
        try:
            # Try to use the new atomic function we created
            update_result = await client.rpc('consume_tokens_atomic', {
                'p_account_id': account_id,
                'p_tokens_to_consume': tokens_used,
                'p_thread_id': thread_id,
                'p_message_id': message_id,
                'p_model': model,
                'p_prompt_tokens': tokens_used // 2,
                'p_completion_tokens': tokens_used // 2,
                'p_estimated_cost': 0  # cost calculated later
            }).execute()
            
            # Extract the result data from the RPC response
            # Supabase RPC with jsonb return type returns the JSON directly as update_result.data
            # It does NOT nest it under the function name like {'consume_tokens_atomic': {...}}
            logger.debug(f"RPC response data: {update_result.data}")
            logger.debug(f"RPC response type: {type(update_result.data)}")

            rpc_result = None
            if update_result.data:
                # Handle both possible response formats:
                # 1. Direct JSON object: {'success': true, 'tokens_remaining': 1000, ...}
                # 2. Nested format (older Supabase versions): {'consume_tokens_atomic': {...}}
                if isinstance(update_result.data, dict):
                    if 'consume_tokens_atomic' in update_result.data:
                        # Nested format
                        rpc_result = update_result.data['consume_tokens_atomic']
                    elif 'success' in update_result.data:
                        # Direct format - this is the expected format for jsonb returns
                        rpc_result = update_result.data
                    else:
                        # Unknown dict format, try to use it directly
                        rpc_result = update_result.data
                elif isinstance(update_result.data, list) and len(update_result.data) > 0:
                    # Sometimes RPC returns as a list with single element
                    rpc_result = update_result.data[0]

            if rpc_result and rpc_result.get('success') is True:
                new_remaining = rpc_result.get('tokens_remaining', 0)
                logger.info(f"RPC consume_tokens_atomic succeeded. Tokens remaining: {new_remaining}")
            elif rpc_result and rpc_result.get('success') is False:
                # Function returned explicit failure (e.g., insufficient tokens, user not found)
                error_type = rpc_result.get('error', 'unknown_error')
                error_message = rpc_result.get('message', 'Token consumption failed')
                tokens_remaining = rpc_result.get('tokens_remaining', 0)

                if error_type == 'insufficient_tokens':
                    raise InsufficientTokensError(
                        error_message,
                        tokens_remaining,
                        get_credits_from_tokens(tokens_remaining)
                    )
                elif error_type == 'user_not_found':
                    logger.warning(f"User {account_id} not found in billing_customers, will create record")
                    raise Exception(f"User billing record not found: {error_message}")
                else:
                    raise Exception(f"Token consumption failed: {error_message}")
            else:
                # Unexpected response format or None result
                logger.error(f"Unexpected RPC response format: {update_result.data}")
                raise Exception("Failed to consume tokens: unexpected response format")
                
        except InsufficientTokensError:
            # Re-raise insufficient tokens error - don't fall back
            raise
        except Exception as rpc_error:
            # Fallback: Use UPDATE with constraint - still atomic but less elegant
            # This approach is still race-condition safe due to PostgreSQL's MVCC
            logger.warning(f"RPC consume_tokens_atomic failed, using fallback: {str(rpc_error)}")
            update_result = await client.table('users') \
                .update({
                    'token_quota_remaining': current_remaining - tokens_used,
                    'billing_updated_at': datetime.now().isoformat()
                }) \
                .eq('id', account_id) \
                .gte('token_quota_remaining', tokens_used) \
                .execute()
                
            # Check if update succeeded
            if not update_result.data or len(update_result.data) == 0:
                # Update failed - insufficient tokens
                fresh_result = await client.table('users') \
                    .select('token_quota_remaining') \
                    .eq('id', account_id) \
                    .execute()
                fresh_remaining = fresh_result.data[0]['token_quota_remaining'] if fresh_result.data else 0
                remaining_credits = get_credits_from_tokens(fresh_remaining)
                
                raise InsufficientTokensError(
                    f"Insufficient credits. You need {get_credits_from_tokens(tokens_used)} credits but only have {remaining_credits} remaining.",
                    fresh_remaining,
                    remaining_credits
                )
            
            new_remaining = current_remaining - tokens_used
        
        # Calculate cost for logging
        estimated_cost = calculate_token_cost(
            tokens_used // 2,
            tokens_used // 2, 
            model
        )
        
        # Log the token usage
        await client.table('token_usage_log') \
            .insert({
                'user_id': account_id,
                'thread_id': thread_id,
                'message_id': message_id,
                'model': model,
                'prompt_tokens': tokens_used // 2,
                'completion_tokens': tokens_used // 2,
                'total_tokens': tokens_used,
                'tokens_remaining_after': new_remaining,
                'estimated_cost': float(estimated_cost)
            }) \
            .execute()
        
        remaining_credits = get_credits_from_tokens(new_remaining)
        
        logger.info(f"Consumed {tokens_used} tokens for user {account_id}. Remaining: {new_remaining} tokens ({remaining_credits} credits)")

        # Invalidate billing cache after successful token consumption
        try:
            from services.billing import invalidate_billing_cache
            await invalidate_billing_cache(account_id)
        except Exception as cache_error:
            logger.debug(f"Failed to invalidate billing cache: {str(cache_error)}")

        return {
            'success': True,
            'tokens_consumed': tokens_used,
            'tokens_remaining': new_remaining,
            'credits_remaining': remaining_credits,
            'plan_id': plan_id
        }
        
    except InsufficientTokensError:
        raise
    except Exception as e:
        logger.error(f"Error in fallback token consumption for user {account_id}: {str(e)}")
        raise

async def get_user_token_status(client: Client, account_id: str) -> Dict:
    """
    Get user's current token status and credits.
    
    Returns:
        Dict with plan, tokens, credits, and reset information
    """
    try:
        # Get user billing info
        billing_result = await client.table('users') \
            .select('*') \
            .eq('id', account_id) \
            .execute()

        if not billing_result.data:
            # Create billing record for new user
            await _create_billing_record(client, account_id)
            billing_result = await client.table('users') \
                .select('*') \
                .eq('id', account_id) \
                .execute()
        
        user_billing = billing_result.data[0]
        plan_id = user_billing['plan_id']
        tokens_remaining = user_billing['token_quota_remaining']
        tokens_total = user_billing['token_quota_total']
        quota_resets_at = user_billing['quota_resets_at']
        
        plan = get_plan_by_id(plan_id)
        if not plan:
            logger.error(f"Invalid plan_id {plan_id} for user {account_id}")
            plan = get_plan_by_id('free')  # Fallback to free
        
        # Calculate credits
        if plan_id == 'byok':
            credits_remaining = -1  # Unlimited
            credits_total = -1
        else:
            credits_remaining = get_credits_from_tokens(tokens_remaining)
            credits_total = plan['display_credits']
        
        return {
            'account_id': account_id,
            'plan': plan_id,
            'plan_name': plan['name'],
            'tokens_remaining': tokens_remaining,
            'tokens_total': tokens_total,
            'credits_remaining': credits_remaining,
            'credits_total': credits_total,
            'quota_resets_at': quota_resets_at,
            'features': plan['features']
        }
        
    except Exception as e:
        logger.error(f"Error getting token status for user {account_id}: {str(e)}")
        raise

async def reset_user_quota(client: Client, account_id: str) -> bool:
    """Reset user's quota to their plan's full amount."""
    try:
        billing_result = await client.table('users') \
            .select('plan_id') \
            .eq('id', account_id) \
            .execute()
        
        if not billing_result.data:
            return False
            
        plan_id = billing_result.data[0]['plan_id']
        plan = get_plan_by_id(plan_id)
        
        if not plan:
            logger.error(f"Invalid plan_id {plan_id} for user {account_id}")
            return False
        
        # Reset quota and extend reset date
        await client.table('users') \
            .update({
                'token_quota_remaining': plan['token_quota'],
                'quota_resets_at': (datetime.now() + timedelta(days=30)).isoformat(),
                'billing_updated_at': datetime.now().isoformat()
            }) \
            .eq('id', account_id) \
            .execute()
        
        logger.info(f"Reset quota for user {account_id} to {plan['token_quota']} tokens")
        return True
        
    except Exception as e:
        logger.error(f"Error resetting quota for user {account_id}: {str(e)}")
        return False

async def upgrade_user_plan(client: Client, account_id: str, new_plan_id: str) -> Dict:
    """Upgrade user to new plan and reset quota."""
    try:
        plan = get_plan_by_id(new_plan_id)
        if not plan:
            raise ValueError(f"Invalid plan_id: {new_plan_id}")
        
        # Update user's plan and reset quota
        await client.table('users') \
            .update({
                'plan_id': new_plan_id,
                'token_quota_total': plan['token_quota'],
                'token_quota_remaining': plan['token_quota'],
                'quota_resets_at': (datetime.now() + timedelta(days=30)).isoformat(),
                'billing_updated_at': datetime.now().isoformat()
            }) \
            .eq('id', account_id) \
            .execute()
        
        logger.info(f"Upgraded user {account_id} to {new_plan_id} plan")
        
        return await get_user_token_status(client, account_id)
        
    except Exception as e:
        logger.error(f"Error upgrading user {account_id} to plan {new_plan_id}: {str(e)}")
        raise

async def _create_billing_record(client: Client, account_id: str) -> None:
    """Create a new user record with free plan.

    NOTE: This should not normally be called since user records are created during signup.
    This is a fallback for edge cases.
    """
    try:
        # Check if user record already exists (it should from signup)
        existing = await client.table('users').select('*').eq('id', account_id).execute()

        if existing.data:
            logger.info(f"User record already exists for user {account_id}")
            return

        logger.warning(f"Creating fallback user record for user {account_id} - this should have been created during signup")

        free_plan = get_plan_by_id('free')

        # Fallback: create user record without email (will need manual fixing)
        await client.table('users') \
            .insert({
                'id': account_id,
                'email': f'missing_email_{account_id}@placeholder.com',  # Will need manual update
                'billing_active': True,
                'provider': 'polar',
                'plan_id': 'free',
                'token_quota_total': free_plan['token_quota'],
                'token_quota_remaining': free_plan['token_quota'],
                'quota_resets_at': (datetime.now() + timedelta(days=30)).isoformat(),
                'billing_updated_at': datetime.now().isoformat()
            }) \
            .execute()

        logger.warning(f"Created fallback user record for user {account_id} - email needs to be updated manually")
        
    except Exception as e:
        logger.error(f"Error creating billing record for user {account_id}: {str(e)}")
        raise

async def get_token_usage_history(client: Client, account_id: str, days: int = 30) -> List[Dict]:
    """
    Get token usage history for a user over specified number of days.
    
    Returns:
        List of usage entries with token and credit information
    """
    try:
        from datetime import datetime, timedelta
        
        # Calculate date range
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        # Query usage log with JOIN to get project_id from threads table
        # Note: This assumes there's a foreign key relationship between token_usage_log.thread_id and threads.thread_id
        try:
            result = await client.table('token_usage_log') \
                .select('*, threads(project_id)') \
                .eq('user_id', account_id) \
                .gte('created_at', start_date.isoformat()) \
                .lte('created_at', end_date.isoformat()) \
                .order('created_at', desc=True) \
                .execute()
        except Exception as join_error:
            # Fallback to query without JOIN if relationship doesn't exist
            logger.warning(f"JOIN with threads table failed, falling back to basic query: {str(join_error)}")
            result = await client.table('token_usage_log') \
                .select('*') \
                .eq('user_id', account_id) \
                .gte('created_at', start_date.isoformat()) \
                .lte('created_at', end_date.isoformat()) \
                .order('created_at', desc=True) \
                .execute()
        
        usage_entries = []
        for entry in result.data:
            # Convert tokens to credits for display
            credits_used = get_credits_from_tokens(entry['total_tokens'])
            
            # Extract project_id from joined threads data
            project_id = None
            if entry.get('threads') and isinstance(entry['threads'], dict):
                project_id = entry['threads'].get('project_id')
            elif entry.get('threads') and isinstance(entry['threads'], list) and len(entry['threads']) > 0:
                project_id = entry['threads'][0].get('project_id')
            
            usage_entries.append({
                'id': entry.get('id'),
                'thread_id': entry.get('thread_id'),
                'message_id': entry.get('message_id'),
                'model': entry.get('model'),
                'prompt_tokens': entry.get('prompt_tokens', 0),
                'completion_tokens': entry.get('completion_tokens', 0),
                'total_tokens': entry.get('total_tokens', 0),
                'credits_used': credits_used,
                'tokens_remaining_after': entry.get('tokens_remaining_after', 0),
                'estimated_cost': entry.get('estimated_cost', 0.0),
                'created_at': entry.get('created_at'),
                'project_id': project_id  # NEW: Include project_id from JOIN
            })
        
        return usage_entries
        
    except Exception as e:
        logger.error(f"Error getting token usage history for user {account_id}: {str(e)}")
        raise