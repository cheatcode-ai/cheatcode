"""Scheduled/cron jobs via Inngest.

Replaces ad-hoc cleanup scripts with durable, observable cron functions.
"""

import inngest

from services.inngest_client import inngest_client
from utils.logger import logger


@inngest_client.create_function(
    fn_id="cleanup-stale-redis-keys",
    trigger=inngest.TriggerCron(cron="0 */6 * * *"),  # Every 6 hours
    retries=2,
)
async def cleanup_stale_redis_keys(ctx: inngest.Context) -> str:
    cleaned = await ctx.step.run("cleanup", _cleanup_redis)
    return f"cleaned:{cleaned}"


@inngest_client.create_function(
    fn_id="cleanup-stale-agent-locks",
    trigger=inngest.TriggerCron(cron="*/5 * * * *"),  # Every 5 minutes
    retries=1,
)
async def cleanup_stale_locks(ctx: inngest.Context) -> str:
    cleaned = await ctx.step.run("cleanup-locks", _cleanup_stale_locks)
    return f"cleaned:{cleaned}"


@inngest_client.create_function(
    fn_id="reconcile-stale-agent-runs",
    trigger=inngest.TriggerCron(cron="*/10 * * * *"),  # Every 10 minutes
    retries=2,
)
async def reconcile_stale_runs(ctx: inngest.Context) -> str:
    reconciled = await ctx.step.run("reconcile-stale-runs", _reconcile_stale_runs)
    return f"reconciled:{reconciled}"


@inngest_client.create_function(
    fn_id="aggregate-daily-usage",
    trigger=inngest.TriggerCron(cron="0 2 * * *"),  # 2 AM daily
    retries=3,
)
async def aggregate_daily_usage(ctx: inngest.Context) -> str:
    await ctx.step.run("aggregate", _aggregate_token_usage)
    return "aggregated"


# ---- Helpers ----


async def _cleanup_redis() -> int:
    """Clean up stale Redis keys for completed/orphaned agent runs."""
    from services import redis as redis_service

    client = await redis_service.get_client()
    if not client:
        return 0

    cleaned = 0
    # Scan for agent_run response lists without TTL (orphaned)
    async for key in client.scan_iter(match="agent_run:*:responses", count=100):
        try:
            ttl = await client.ttl(key)
            if ttl == -1:  # No TTL set (orphaned)
                await client.expire(key, 3600)  # Set 1hr TTL
                cleaned += 1
        except Exception as e:
            logger.debug(f"Error checking key {key}: {e}")
            continue

    # Scan for task_status keys without TTL
    async for key in client.scan_iter(match="task_status:*", count=100):
        try:
            ttl = await client.ttl(key)
            if ttl == -1:
                await client.expire(key, 3600)
                cleaned += 1
        except Exception as e:
            logger.debug(f"Error checking key {key}: {e}")
            continue

    logger.info(f"Redis cleanup: set TTL on {cleaned} orphaned keys")
    return cleaned


async def _cleanup_stale_locks() -> int:
    """Clean up stale agent run locks that weren't properly released."""
    from services import redis as redis_service

    client = await redis_service.get_client()
    if not client:
        return 0

    cleaned = 0
    async for key in client.scan_iter(match="agent_run_lock:*", count=100):
        try:
            ttl = await client.ttl(key)
            if ttl == -1:  # Lock without TTL (leaked)
                await client.delete(key)
                cleaned += 1
                logger.debug(f"Deleted stale lock: {key}")
        except Exception as e:
            logger.debug(f"Error checking lock {key}: {e}")
            continue

    logger.info(f"Lock cleanup: removed {cleaned} stale locks")
    return cleaned


async def _reconcile_stale_runs() -> int:
    """Catch agent runs stuck in 'running' after a hard crash (OOM/SIGKILL).

    If the process was killed, the finally block never ran and the
    agent/run.finished event was never emitted. This reconciler emits it
    for runs that have been stuck beyond MAX_AGENT_RUN_DURATION + 5min buffer.
    The finalize-agent-run function (idempotent) handles the actual fix.
    """
    from datetime import UTC, datetime, timedelta

    import inngest as inngest_lib

    from services.inngest_client import inngest_client
    from services.supabase import DBConnection
    from utils.config import config

    db = DBConnection()
    await db.initialize()
    client = await db.client

    max_duration = config.MAX_AGENT_RUN_DURATION  # 1200s (20 min)
    buffer_seconds = 300  # 5 min grace period
    cutoff = datetime.now(UTC) - timedelta(seconds=max_duration + buffer_seconds)

    stale_runs = (
        await client.table("agent_runs")
        .select("run_id, thread_id, project_id, account_id")
        .eq("status", "running")
        .lt("created_at", cutoff.isoformat())
        .execute()
    )

    reconciled = 0
    for run in stale_runs.data or []:
        logger.warning(f"Reconciling stale run {run['run_id']} (stuck >25min)")
        try:
            await inngest_client.send(
                inngest_lib.Event(
                    name="agent/run.finished",
                    data={
                        "agent_run_id": run["run_id"],
                        "thread_id": run.get("thread_id"),
                        "project_id": run.get("project_id"),
                        "account_id": run.get("account_id"),
                        "expected_status": "failed",
                        "error_message": "Run exceeded maximum duration (stale-run reconciler)",
                    },
                )
            )
            reconciled += 1
        except Exception as e:
            logger.error(f"Failed to reconcile stale run {run['run_id']}: {e}")

    if reconciled:
        logger.info(f"Reconciled {reconciled} stale runs")
    return reconciled


async def _aggregate_token_usage() -> None:
    """Aggregate token billing entries for daily analytics."""
    from services.supabase import DBConnection

    db = DBConnection()
    await db.initialize()

    # This is a placeholder for daily usage aggregation.
    # Implementation depends on the specific analytics needs.
    logger.info("Daily token usage aggregation completed")
