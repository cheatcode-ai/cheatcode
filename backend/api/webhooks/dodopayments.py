"""
DodoPayments webhook handler for subscription events.
"""

from fastapi import APIRouter, Request, HTTPException
import hmac
import hashlib
import json
from datetime import datetime
from typing import Dict, Any

from services.supabase import DBConnection
from utils.logger import logger
from utils.config import config

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def verify_webhook_signature(payload: bytes, signature: str, secret: str) -> bool:
    """Verify DodoPayments webhook signature."""
    try:
        expected_signature = hmac.new(
            secret.encode(),
            payload,
            hashlib.sha256
        ).hexdigest()
        
        # Compare signatures
        return hmac.compare_digest(f"sha256={expected_signature}", signature)
    except Exception as e:
        logger.error(f"Error verifying webhook signature: {e}")
        return False


async def handle_subscription_created(event_data: Dict[str, Any]):
    """Handle subscription.created event and update token quotas."""
    try:
        from utils.constants import get_plan_by_id
        
        db = DBConnection()
        client = await db.client
        
        subscription = event_data.get("subscription", {})
        customer = event_data.get("customer", {})
        
        plan_name = map_dodo_plan_to_internal(subscription.get("plan_name", ""))
        account_id = subscription.get("metadata", {}).get("account_id")
        
        # Get plan configuration
        plan_config = get_plan_by_id(plan_name)
        if not plan_config:
            logger.error(f"Invalid plan_name: {plan_name}")
            raise ValueError(f"Invalid plan_name: {plan_name}")
        
        # Map DodoPayments subscription to our database
        subscription_data = {
            "dodo_subscription_id": subscription.get("id"),
            "dodo_customer_id": customer.get("id"),
            "account_id": account_id,
            "plan_name": plan_name,
            "status": map_dodo_status_to_internal(subscription.get("status", "")),
            "current_period_start": subscription.get("current_period_start"),
            "current_period_end": subscription.get("current_period_end"),
            "metadata": subscription.get("metadata", {}),
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        # Insert or update subscription
        result = client.table("user_subscriptions").upsert(
            subscription_data,
            on_conflict="dodo_subscription_id"
        ).execute()
        
        # Update billing_customers with new token quota
        if account_id:
            from datetime import timedelta
            new_quota_reset = datetime.utcnow() + timedelta(days=30)
            await client.schema('basejump').table('billing_customers').update({
                'plan_id': plan_name,
                'token_quota_total': plan_config['token_quota'],
                'token_quota_remaining': plan_config['token_quota'],
                'quota_resets_at': new_quota_reset.isoformat(),
                'billing_updated_at': datetime.utcnow().isoformat()
            }).eq('account_id', account_id).execute()
            
            logger.info(f"✅ Updated token quota for account {account_id}: {plan_config['token_quota']} tokens ({plan_config['display_credits']} credits)")
        
        logger.info(f"Created/updated subscription for account {account_id}: {subscription.get('id')}")
        
    except Exception as e:
        logger.error(f"Error handling subscription.created: {e}")
        raise


async def handle_subscription_updated(event_data: Dict[str, Any]):
    """Handle subscription.updated event and update token quotas."""
    try:
        from utils.constants import get_plan_by_id
        
        db = DBConnection()
        client = await db.client
        
        subscription = event_data.get("subscription", {})
        plan_name = map_dodo_plan_to_internal(subscription.get("plan_name", ""))
        
        # Get plan configuration
        plan_config = get_plan_by_id(plan_name)
        if not plan_config:
            logger.error(f"Invalid plan_name: {plan_name}")
            raise ValueError(f"Invalid plan_name: {plan_name}")
        
        # Update subscription in database
        update_data = {
            "plan_name": plan_name,
            "status": map_dodo_status_to_internal(subscription.get("status", "")),
            "current_period_start": subscription.get("current_period_start"),
            "current_period_end": subscription.get("current_period_end"),
            "metadata": subscription.get("metadata", {}),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        result = client.table("user_subscriptions").update(update_data).eq(
            "dodo_subscription_id", subscription.get("id")
        ).execute()
        
        # Get account_id from subscription to update token quota
        if result.data and len(result.data) > 0:
            account_id = result.data[0].get('account_id')
            if account_id:
                # Update billing_customers with new token quota (on plan change)
                await client.schema('basejump').table('billing_customers').update({
                    'plan_id': plan_name,
                    'token_quota_total': plan_config['token_quota'],
                    # Note: Don't reset remaining tokens on update unless it's a plan upgrade
                    'billing_updated_at': datetime.utcnow().isoformat()
                }).eq('account_id', account_id).execute()
                
                logger.info(f"✅ Updated subscription and quota for account {account_id}: {plan_config['token_quota']} tokens")
        
        logger.info(f"Updated subscription: {subscription.get('id')}")
        
    except Exception as e:
        logger.error(f"Error handling subscription.updated: {e}")
        raise


async def handle_subscription_cancelled(event_data: Dict[str, Any]):
    """Handle subscription.cancelled event."""
    try:
        db = DBConnection()
        client = await db.client
        
        subscription = event_data.get("subscription", {})
        
        # Update subscription status to cancelled
        update_data = {
            "status": "cancelled",
            "updated_at": datetime.utcnow().isoformat()
        }
        
        result = client.table("user_subscriptions").update(update_data).eq(
            "dodo_subscription_id", subscription.get("id")
        ).execute()
        
        logger.info(f"Cancelled subscription: {subscription.get('id')}")
        
    except Exception as e:
        logger.error(f"Error handling subscription.cancelled: {e}")
        raise


async def handle_payment_succeeded(event_data: Dict[str, Any]):
    """Handle payment.succeeded event."""
    try:
        payment = event_data.get("payment", {})
        subscription = event_data.get("subscription", {})
        
        # Update subscription to active if payment succeeded
        if subscription:
            db = DBConnection()
            client = await db.client
            
            update_data = {
                "status": "active",
                "updated_at": datetime.utcnow().isoformat()
            }
            
            result = client.table("user_subscriptions").update(update_data).eq(
                "dodo_subscription_id", subscription.get("id")
            ).execute()
            
            logger.info(f"Payment succeeded for subscription: {subscription.get('id')}")
            
    except Exception as e:
        logger.error(f"Error handling payment.succeeded: {e}")
        raise


async def handle_payment_failed(event_data: Dict[str, Any]):
    """Handle payment.failed event."""
    try:
        payment = event_data.get("payment", {})
        subscription = event_data.get("subscription", {})
        
        # Update subscription status if payment failed
        if subscription:
            db = DBConnection()
            client = await db.client
            
            update_data = {
                "status": "past_due",
                "updated_at": datetime.utcnow().isoformat()
            }
            
            result = client.table("user_subscriptions").update(update_data).eq(
                "dodo_subscription_id", subscription.get("id")
            ).execute()
            
            logger.warning(f"Payment failed for subscription: {subscription.get('id')}")
            
    except Exception as e:
        logger.error(f"Error handling payment.failed: {e}")
        raise


def map_dodo_plan_to_internal(dodo_plan: str) -> str:
    """Map DodoPayments plan names to our internal plan names."""
    plan_mapping = {
        "Free Plan": "free",
        "Pro Plan": "pro", 
        "Premium Plan": "premium"
    }
    return plan_mapping.get(dodo_plan, "free")


def map_dodo_status_to_internal(dodo_status: str) -> str:
    """Map DodoPayments status to our internal status."""
    status_mapping = {
        "active": "active",
        "cancelled": "cancelled",
        "expired": "expired",
        "trialing": "trialing",
        "pending": "pending",
        "past_due": "past_due"
    }
    return status_mapping.get(dodo_status, "active")


@router.post("/dodopayments")
async def handle_dodopayments_webhook(request: Request):
    """Handle DodoPayments webhook events."""
    try:
        # Get raw payload
        payload = await request.body()
        
        # Verify webhook signature
        signature = request.headers.get("X-Dodo-Signature")
        if not signature:
            raise HTTPException(status_code=400, detail="Missing signature header")
        
        if not verify_webhook_signature(payload, signature, config.DODO_PAYMENTS_WEBHOOK_SECRET):
            raise HTTPException(status_code=400, detail="Invalid signature")
        
        # Parse event data
        try:
            event_data = json.loads(payload)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")
        
        event_type = event_data.get("type")
        if not event_type:
            raise HTTPException(status_code=400, detail="Missing event type")
        
        logger.info(f"Received DodoPayments webhook: {event_type}")
        
        # Handle different event types
        if event_type == "subscription.created":
            await handle_subscription_created(event_data)
        elif event_type == "subscription.updated":
            await handle_subscription_updated(event_data)
        elif event_type == "subscription.cancelled":
            await handle_subscription_cancelled(event_data)
        elif event_type == "payment.succeeded":
            await handle_payment_succeeded(event_data)
        elif event_type == "payment.failed":
            await handle_payment_failed(event_data)
        else:
            logger.info(f"Unhandled webhook event type: {event_type}")
        
        return {"status": "success"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing DodoPayments webhook: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")