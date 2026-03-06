"""Polar.sh webhook handler for subscription events."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from services.api_key_resolver import APIKeyResolver
from services.billing import invalidate_billing_cache
from services.supabase import DBConnection
from utils.config import config
from utils.constants import get_plan_by_id
from utils.logger import logger

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def get_plan_from_product_id(product_id: str) -> str:
    """Map Polar product ID to internal plan name."""
    mapping = {
        config.POLAR_PRODUCT_ID_PRO: "pro",
        config.POLAR_PRODUCT_ID_PREMIUM: "premium",
        config.POLAR_PRODUCT_ID_BYOK: "byok",
    }
    return mapping.get(product_id, "free")


async def handle_subscription_created(data: dict[str, Any]):
    """Handle subscription.created event and update token quotas."""
    try:
        db = DBConnection()
        client = await db.client

        # Extract data from Polar webhook
        subscription_id = data.get("id")
        customer = data.get("customer", {})
        account_id = customer.get("external_id")  # Our user ID stored as external_id
        product = data.get("product", {})
        product_id = product.get("id")

        # Get plan from product ID
        plan_name = get_plan_from_product_id(product_id)

        # Also check metadata for plan_id (more reliable)
        metadata = data.get("metadata", {})
        if metadata.get("plan_id"):
            plan_name = metadata.get("plan_id")

        logger.info(f"Processing subscription.created for account {account_id}, plan {plan_name}")

        # Get plan configuration
        plan_config = get_plan_by_id(plan_name)
        if not plan_config:
            logger.error(f"Invalid plan_name: {plan_name}")
            raise ValueError(f"Invalid plan_name: {plan_name}")

        # Upsert subscription record
        subscription_data = {
            "polar_subscription_id": subscription_id,
            "polar_customer_id": customer.get("id"),
            "user_id": account_id,
            "plan_name": plan_name,
            "status": "active",
            "current_period_start": data.get("current_period_start"),
            "current_period_end": data.get("current_period_end"),
            "metadata": {"polar_product_id": product_id, "polar_customer_email": customer.get("email")},
            "created_at": datetime.now(tz=UTC).isoformat(),
            "updated_at": datetime.now(tz=UTC).isoformat(),
        }

        # Insert or update subscription
        await (
            client.table("user_subscriptions").upsert(subscription_data, on_conflict="polar_subscription_id").execute()
        )

        # Update users table with new token quota
        if account_id:
            new_quota_reset = datetime.now(tz=UTC) + timedelta(days=30)
            await (
                client.table("users")
                .update(
                    {
                        "plan_id": plan_name,
                        "provider": "polar",
                        "token_quota_total": plan_config["token_quota"],
                        "token_quota_remaining": plan_config["token_quota"],
                        "quota_resets_at": new_quota_reset.isoformat(),
                        "billing_updated_at": datetime.now(tz=UTC).isoformat(),
                    }
                )
                .eq("id", account_id)
                .execute()
            )

            logger.info(
                f"Updated token quota for account {account_id}: {plan_config['token_quota']} tokens ({plan_config['display_credits']} credits)"
            )

            # Invalidate billing and plan caches
            await invalidate_billing_cache(account_id)
            await APIKeyResolver.clear_user_plan_cache(account_id)

        logger.info(f"Created/updated subscription for account {account_id}: {subscription_id}")

    except Exception as e:
        logger.error(f"Error handling subscription.created: {e}")
        raise


async def handle_subscription_updated(data: dict[str, Any]):
    """Handle subscription.updated event (renewals, plan changes)."""
    try:
        db = DBConnection()
        client = await db.client

        subscription_id = data.get("id")
        status = data.get("status", "active")
        product = data.get("product", {})
        product_id = product.get("id")
        plan_name = get_plan_from_product_id(product_id)

        # Get plan configuration
        plan_config = get_plan_by_id(plan_name)
        if not plan_config:
            logger.error(f"Invalid plan_name: {plan_name}")
            return

        # Update subscription in database
        update_data = {
            "plan_name": plan_name,
            "status": status,
            "current_period_start": data.get("current_period_start"),
            "current_period_end": data.get("current_period_end"),
            "updated_at": datetime.now(tz=UTC).isoformat(),
        }

        result = await (
            client.table("user_subscriptions")
            .update(update_data)
            .eq("polar_subscription_id", subscription_id)
            .execute()
        )

        # Get user_id from subscription to update token quota
        if result.data and len(result.data) > 0:
            account_id = result.data[0].get("user_id")
            if account_id:
                # Update users table with new token quota (on plan change/renewal)
                await (
                    client.table("users")
                    .update(
                        {
                            "plan_id": plan_name,
                            "token_quota_total": plan_config["token_quota"],
                            "billing_updated_at": datetime.now(tz=UTC).isoformat(),
                        }
                    )
                    .eq("id", account_id)
                    .execute()
                )

                logger.info(
                    f"Updated subscription and quota for account {account_id}: {plan_config['token_quota']} tokens"
                )

                # Invalidate billing and plan caches
                await invalidate_billing_cache(account_id)
                await APIKeyResolver.clear_user_plan_cache(account_id)

        logger.info(f"Updated subscription: {subscription_id}")

    except Exception as e:
        logger.error(f"Error handling subscription.updated: {e}")
        raise


async def handle_subscription_canceled(data: dict[str, Any]):
    """Handle subscription.canceled event."""
    try:
        db = DBConnection()
        client = await db.client

        subscription_id = data.get("id")

        # Update subscription status to cancelled
        result = await (
            client.table("user_subscriptions")
            .update({"status": "canceled", "updated_at": datetime.now(tz=UTC).isoformat()})
            .eq("polar_subscription_id", subscription_id)
            .execute()
        )

        # Downgrade user to free plan
        if result.data and len(result.data) > 0:
            account_id = result.data[0].get("user_id")
            if account_id:
                free_plan = get_plan_by_id("free")
                await (
                    client.table("users")
                    .update(
                        {
                            "plan_id": "free",
                            "token_quota_total": free_plan["token_quota"],
                            "token_quota_remaining": free_plan["token_quota"],
                            "billing_updated_at": datetime.now(tz=UTC).isoformat(),
                        }
                    )
                    .eq("id", account_id)
                    .execute()
                )

                logger.info(f"Downgraded account {account_id} to free plan after subscription cancellation")

                # Invalidate billing and plan caches
                await invalidate_billing_cache(account_id)
                await APIKeyResolver.clear_user_plan_cache(account_id)

        logger.info(f"Cancelled subscription: {subscription_id}")

    except Exception as e:
        logger.error(f"Error handling subscription.canceled: {e}")
        raise


async def handle_order_paid(data: dict[str, Any]):
    """Handle order.paid event (for one-time payments or subscription renewals)."""
    try:
        order_id = data.get("id")
        customer = data.get("customer", {})
        account_id = customer.get("external_id")

        logger.info(f"Order paid: {order_id} for account {account_id}")

        # For subscription renewals, the subscription.updated event handles quota updates
        # This is mainly for logging and any future one-time purchase handling

    except Exception as e:
        logger.error(f"Error handling order.paid: {e}")
        raise


async def handle_subscription_active(data: dict[str, Any]):
    """Handle subscription.active event (subscription became active)."""
    try:
        db = DBConnection()
        client = await db.client

        subscription_id = data.get("id")

        # Update subscription status to active
        await (
            client.table("user_subscriptions")
            .update({"status": "active", "updated_at": datetime.now(tz=UTC).isoformat()})
            .eq("polar_subscription_id", subscription_id)
            .execute()
        )

        logger.info(f"Subscription activated: {subscription_id}")

    except Exception as e:
        logger.error(f"Error handling subscription.active: {e}")
        raise


@router.post("/polar")
async def handle_polar_webhook(request: Request):
    """Handle Polar webhook events.

    When Inngest is configured (INNGEST_EVENT_KEY set), events are emitted to Inngest
    for durable, step-based processing. Otherwise, falls back to inline processing.
    """
    try:
        # Lazy load - only needed when webhook is called
        from polar_sdk.webhooks import WebhookVerificationError, validate_event

        # Get raw payload
        payload = await request.body()

        # Verify webhook signature using Polar SDK (always synchronous)
        try:
            event = validate_event(payload=payload, headers=dict(request.headers), secret=config.POLAR_WEBHOOK_SECRET)
        except WebhookVerificationError as e:
            logger.warning(f"Invalid Polar webhook signature: {e}")
            raise HTTPException(status_code=403, detail="Invalid signature") from e

        event_type = event.type
        data = event.data

        logger.info(f"Received Polar webhook: {event_type}")

        # If Inngest is configured, emit event for durable processing
        if config.INNGEST_EVENT_KEY:
            import hashlib

            import inngest as inngest_lib

            from services.inngest_client import inngest_client

            event_id = getattr(event, "id", None)
            if not event_id:
                data_id = data.get("id") if isinstance(data, dict) else None
                event_id = data_id or hashlib.sha256(payload).hexdigest()[:16]

            await inngest_client.send(
                inngest_lib.Event(
                    name="webhook/polar.received",
                    data={
                        "event_type": event_type,
                        "payload": data if isinstance(data, dict) else {},
                    },
                    id=f"polar-{event_id}",
                )
            )
            logger.info(f"Polar webhook {event_type} emitted to Inngest")
            return {"status": "accepted"}

        # Fallback: inline processing (no Inngest configured)
        if event_type == "subscription.created":
            await handle_subscription_created(data)
        elif event_type == "subscription.updated":
            await handle_subscription_updated(data)
        elif event_type == "subscription.canceled":
            await handle_subscription_canceled(data)
        elif event_type == "subscription.active":
            await handle_subscription_active(data)
        elif event_type == "order.paid":
            await handle_order_paid(data)
        else:
            logger.info(f"Unhandled webhook event type: {event_type}")

        return {"status": "success"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing Polar webhook: {e}")
        raise HTTPException(status_code=500, detail="Internal server error") from e
