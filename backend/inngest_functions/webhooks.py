"""Durable webhook processing via Inngest.

Each step is independently retryable. If credit allocation fails,
only that step retries -- signature verification and DB update are memoized.
"""

import datetime
from datetime import UTC

import inngest

from services.inngest_client import inngest_client
from utils.logger import logger


async def _on_webhook_failure(ctx: inngest.Context) -> None:
    """Alert when a Polar webhook permanently fails after all retries."""
    event_data = ctx.event.data.get("event", {}).get("data", {})
    event_type = event_data.get("event_type", "unknown")
    account_id = _extract_account_id(event_data.get("payload", {}))
    error_msg = ctx.event.data.get("error", {}).get("message", "unknown")

    logger.critical(f"Polar webhook permanently failed: type={event_type} account={account_id} error={error_msg}")

    import sentry_sdk

    with sentry_sdk.push_scope() as scope:
        scope.set_tag("webhook_event_type", event_type)
        scope.set_tag("account_id", account_id)
        scope.set_extra("error_message", error_msg)
        sentry_sdk.capture_message(
            f"Polar webhook failed permanently: {event_type}",
            level="fatal",
        )


@inngest_client.create_function(
    fn_id="process-polar-webhook",
    trigger=inngest.TriggerEvent(event="webhook/polar.received"),
    retries=5,
    concurrency=[
        inngest.Concurrency(limit=10),
    ],
    on_failure=_on_webhook_failure,
)
async def process_polar_webhook(ctx: inngest.Context) -> str:
    webhook_data = ctx.event.data
    event_type = webhook_data["event_type"]
    payload = webhook_data["payload"]

    if event_type == "subscription.created":
        await ctx.step.run("upsert-subscription", _upsert_subscription, payload)
        await ctx.step.run("update-token-quota", _update_token_quota, payload)
        await ctx.step.run("invalidate-cache", _invalidate_billing_cache, payload)
        await ctx.step.send_event(
            "notify-subscriber",
            inngest.Event(
                name="email/subscription.confirmed",
                data={"user_id": _extract_account_id(payload), "plan": _extract_plan(payload)},
            ),
        )
        await ctx.step.send_event(
            "welcome-email",
            inngest.Event(
                name="email/welcome",
                data={"user_id": _extract_account_id(payload)},
            ),
        )
        return "subscription_created"

    if event_type == "subscription.updated":
        await ctx.step.run("update-subscription", _upsert_subscription, payload)
        await ctx.step.run("refresh-token-quota", _update_token_quota, payload)
        await ctx.step.run("invalidate-cache", _invalidate_billing_cache, payload)
        return "subscription_updated"

    if event_type == "subscription.canceled":
        await ctx.step.run("cancel-subscription", _cancel_subscription, payload)
        await ctx.step.run("invalidate-cache", _invalidate_billing_cache, payload)
        await ctx.step.send_event(
            "notify-cancellation",
            inngest.Event(
                name="email/subscription.canceled",
                data={"user_id": _extract_account_id(payload)},
            ),
        )
        return "subscription_canceled"

    if event_type == "subscription.active":
        await ctx.step.run("activate-subscription", _activate_subscription, payload)
        return "subscription_activated"

    if event_type == "order.paid":
        await ctx.step.run("process-order", _process_order_payment, payload)
        return "order_processed"

    return f"unhandled_event:{event_type}"


# ---- Helpers ----


def _extract_account_id(payload: dict) -> str:
    customer = payload.get("customer", {})
    return customer.get("external_id", "")


def _extract_plan(payload: dict) -> str:
    from utils.config import config

    product = payload.get("product", {})
    product_id = product.get("id")
    mapping = {
        config.POLAR_PRODUCT_ID_PRO: "pro",
        config.POLAR_PRODUCT_ID_PREMIUM: "premium",
        config.POLAR_PRODUCT_ID_BYOK: "byok",
    }
    plan = mapping.get(product_id, "free")
    metadata = payload.get("metadata", {})
    if metadata.get("plan_id"):
        plan = metadata["plan_id"]
    return plan


async def _upsert_subscription(payload: dict) -> dict:
    """Insert or update subscription in Supabase."""
    from services.supabase import DBConnection
    from utils.constants import get_plan_by_id

    db = DBConnection()
    client = await db.client

    subscription_id = payload.get("id")
    customer = payload.get("customer", {})
    account_id = customer.get("external_id")
    product = payload.get("product", {})
    product_id = product.get("id")

    plan_name = _extract_plan(payload)
    plan_config = get_plan_by_id(plan_name)
    if not plan_config:
        raise ValueError(f"Invalid plan_name: {plan_name}")

    subscription_data = {
        "polar_subscription_id": subscription_id,
        "polar_customer_id": customer.get("id"),
        "user_id": account_id,
        "plan_name": plan_name,
        "status": "active",
        "current_period_start": payload.get("current_period_start"),
        "current_period_end": payload.get("current_period_end"),
        "metadata": {
            "polar_product_id": product_id,
            "polar_customer_email": customer.get("email"),
        },
        "created_at": datetime.datetime.now(tz=UTC).isoformat(),
        "updated_at": datetime.datetime.now(tz=UTC).isoformat(),
    }

    await client.table("user_subscriptions").upsert(subscription_data, on_conflict="polar_subscription_id").execute()

    logger.info(f"Upserted subscription {subscription_id} for account {account_id}")
    return {"status": "upserted", "subscription_id": subscription_id}


async def _update_token_quota(payload: dict) -> dict:
    """Update user's token quota based on subscription plan."""
    from services.supabase import DBConnection
    from utils.constants import get_plan_by_id

    db = DBConnection()
    client = await db.client

    account_id = _extract_account_id(payload)
    plan_name = _extract_plan(payload)
    plan_config = get_plan_by_id(plan_name)

    if not plan_config or not account_id:
        return {"status": "skipped"}

    new_quota_reset = datetime.datetime.now(tz=UTC) + datetime.timedelta(days=30)
    await (
        client.table("users")
        .update(
            {
                "plan_id": plan_name,
                "provider": "polar",
                "token_quota_total": plan_config["token_quota"],
                "token_quota_remaining": plan_config["token_quota"],
                "quota_resets_at": new_quota_reset.isoformat(),
                "billing_updated_at": datetime.datetime.now(tz=UTC).isoformat(),
            }
        )
        .eq("id", account_id)
        .execute()
    )

    logger.info(f"Updated token quota for {account_id}: {plan_config['token_quota']} tokens")
    return {"status": "quota_updated"}


async def _invalidate_billing_cache(payload: dict) -> None:
    """Invalidate Redis billing cache for the user."""
    from services.billing import invalidate_billing_cache

    account_id = _extract_account_id(payload)
    if account_id:
        await invalidate_billing_cache(account_id)
        logger.info(f"Invalidated billing cache for {account_id}")


async def _cancel_subscription(payload: dict) -> dict:
    """Downgrade user to free plan."""
    from services.billing import invalidate_billing_cache
    from services.supabase import DBConnection
    from utils.constants import get_plan_by_id

    db = DBConnection()
    client = await db.client

    subscription_id = payload.get("id")

    result = await (
        client.table("user_subscriptions")
        .update(
            {
                "status": "canceled",
                "updated_at": datetime.datetime.now(tz=UTC).isoformat(),
            }
        )
        .eq("polar_subscription_id", subscription_id)
        .execute()
    )

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
                        "billing_updated_at": datetime.datetime.now(tz=UTC).isoformat(),
                    }
                )
                .eq("id", account_id)
                .execute()
            )
            await invalidate_billing_cache(account_id)
            logger.info(f"Downgraded {account_id} to free plan")

    return {"status": "canceled"}


async def _activate_subscription(payload: dict) -> dict:
    """Mark subscription as active."""
    from services.supabase import DBConnection

    db = DBConnection()
    client = await db.client

    subscription_id = payload.get("id")
    await (
        client.table("user_subscriptions")
        .update(
            {
                "status": "active",
                "updated_at": datetime.datetime.now(tz=UTC).isoformat(),
            }
        )
        .eq("polar_subscription_id", subscription_id)
        .execute()
    )

    logger.info(f"Activated subscription: {subscription_id}")
    return {"status": "activated"}


async def _process_order_payment(payload: dict) -> dict:
    """Process one-time payment order (logging only for now)."""
    order_id = payload.get("id")
    account_id = _extract_account_id(payload)
    logger.info(f"Order paid: {order_id} for account {account_id}")
    return {"status": "processed"}
