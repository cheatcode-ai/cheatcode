"""Email notification functions via Inngest.

Handles sending emails triggered by various events (subscription changes,
deployment completions, welcome emails).
"""

import datetime
from datetime import timedelta

import inngest

from services.inngest_client import inngest_client
from utils.logger import logger


@inngest_client.create_function(
    fn_id="send-email-notification",
    trigger=[
        inngest.TriggerEvent(event="email/subscription.confirmed"),
        inngest.TriggerEvent(event="email/subscription.canceled"),
        inngest.TriggerEvent(event="deployment/completed"),
        inngest.TriggerEvent(event="email/welcome"),
    ],
    retries=3,
    throttle=inngest.Throttle(
        limit=10,
        period=datetime.timedelta(seconds=60),
        key="event.data.user_id",
    ),
)
async def send_email_notification(ctx: inngest.Context) -> str:
    event_name = ctx.event.name
    user_id = ctx.event.data.get("user_id")

    if not user_id:
        logger.warning(f"Email notification skipped: no user_id in event {event_name}")
        return "skipped:no_user_id"

    # Step 1: Resolve email address
    user = await ctx.step.run("get-user", _get_user_email, user_id)

    if not user.get("email"):
        logger.warning(f"Email notification skipped: no email for user {user_id}")
        return "skipped:no_email"

    # Step 2: Send based on event type
    if event_name == "email/welcome":
        await ctx.step.sleep("delay-welcome", timedelta(hours=1))
        await ctx.step.run("send-welcome", _send_welcome_email, user["email"], user.get("name"))
        return "sent:welcome"

    if event_name == "email/subscription.confirmed":
        plan = ctx.event.data.get("plan", "pro")
        await ctx.step.run("send-sub-confirmed", _send_subscription_email, user["email"], plan, "confirmed")
        return "sent:subscription_confirmed"

    if event_name == "email/subscription.canceled":
        await ctx.step.run("send-sub-canceled", _send_subscription_email, user["email"], "", "canceled")
        return "sent:subscription_canceled"

    if event_name == "deployment/completed":
        url = ctx.event.data.get("url", "")
        project_id = ctx.event.data.get("project_id", "")
        await ctx.step.run("send-deploy-complete", _send_deployment_email, user["email"], url, project_id)
        return "sent:deployment_completed"

    return f"skipped:unknown_event:{event_name}"


# ---- Helpers ----


async def _get_user_email(user_id: str) -> dict:
    """Fetch user email from Supabase."""
    from services.supabase import DBConnection

    db = DBConnection()
    client = await db.client

    result = await client.table("users").select("id, email, name").eq("id", user_id).single().execute()
    if result.data:
        return {"email": result.data.get("email"), "name": result.data.get("name")}
    return {"email": None, "name": None}


async def _send_welcome_email(email: str, name: str) -> None:
    """Send welcome email via Mailtrap."""
    from services.email import email_service

    success = email_service.send_welcome_email(email, name)
    if not success:
        raise Exception(f"Failed to send welcome email to {email}")
    logger.info(f"Welcome email sent to {email}")


async def _send_subscription_email(email: str, plan: str, status: str) -> None:
    """Send subscription status email."""
    # For now, log only. Full template to be added in follow-up.
    logger.info(f"Subscription {status} email would be sent to {email} (plan: {plan})")


async def _send_deployment_email(email: str, url: str, project_id: str) -> None:
    """Send deployment completion email."""
    # For now, log only. Full template to be added in follow-up.
    logger.info(f"Deployment complete email would be sent to {email} (url: {url}, project: {project_id})")
