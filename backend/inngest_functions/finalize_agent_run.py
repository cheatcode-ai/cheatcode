"""Durable finalization for agent runs.

Safety net: if the inline finalization in agent_run.py fails (crash, timeout),
this function ensures DB status is correct and SSE consumers are notified.
Uses step.run() for durable, memoized execution.

Triggered by the agent/run.finished event emitted at the end of process_agent_run.
"""

import inngest

from services.inngest_client import inngest_client
from utils.logger import logger


@inngest_client.create_function(
    fn_id="finalize-agent-run",
    trigger=inngest.TriggerEvent(event="agent/run.finished"),
    retries=3,
    idempotency="event.data.agent_run_id",
)
async def finalize_agent_run(ctx: inngest.Context) -> dict:
    """Verify and fix agent run DB status, ensure SSE termination."""
    agent_run_id = ctx.event.data["agent_run_id"]
    expected_status = ctx.event.data["expected_status"]
    error_message = ctx.event.data.get("error_message")

    # Step 1: Verify and fix DB status
    result = await ctx.step.run(
        "verify-db-status",
        _verify_db_status,
        agent_run_id,
        expected_status,
        error_message,
    )

    # Step 2: Ensure control signal was published
    await ctx.step.run(
        "ensure-control-signal",
        _ensure_control_signal,
        agent_run_id,
        expected_status,
    )

    # Step 3: Emit completion event for downstream (analytics, billing summary)
    if expected_status == "completed":
        await ctx.step.send_event(
            "notify-completion",
            inngest.Event(
                name="agent/run.completed",
                data={
                    "agent_run_id": agent_run_id,
                    "thread_id": ctx.event.data.get("thread_id"),
                    "project_id": ctx.event.data.get("project_id"),
                    "account_id": ctx.event.data.get("account_id"),
                    "total_responses": ctx.event.data.get("total_responses", 0),
                    "duration_seconds": ctx.event.data.get("duration_seconds", 0),
                    "model_name": ctx.event.data.get("model_name"),
                },
            ),
        )

    return result


async def _verify_db_status(
    agent_run_id: str,
    expected_status: str,
    error_message: str | None,
) -> dict:
    """Check DB status matches expected. Fix if inline finalization failed."""
    from inngest_functions.agent_run import update_agent_run_status
    from services.supabase import DBConnection

    db = DBConnection()
    await db.initialize()
    client = await db.client

    run_data = await client.table("agent_runs").select("status").eq("run_id", agent_run_id).execute()
    if not run_data.data:
        return {"action": "not_found"}

    current_status = run_data.data[0]["status"]

    if current_status == expected_status:
        return {"action": "already_correct", "status": current_status}

    if current_status == "running":
        # Inline finalization failed — fix it
        logger.warning(f"Agent run {agent_run_id} stuck in 'running', fixing to '{expected_status}'")
        await update_agent_run_status(
            client,
            agent_run_id,
            expected_status,
            error=error_message,
        )
        return {"action": "fixed", "from": "running", "to": expected_status}

    # Status already terminal (completed/failed/stopped) but different from expected
    return {"action": "skipped", "current": current_status, "expected": expected_status}


async def _ensure_control_signal(agent_run_id: str, expected_status: str) -> dict:
    """Publish control signal if SSE consumers are still waiting."""
    from services import redis

    await redis.initialize_async()

    control_channel = f"agent_run:{agent_run_id}:control"
    control_signal = {
        "completed": "END_STREAM",
        "failed": "ERROR",
        "stopped": "STOP",
    }.get(expected_status, "ERROR")

    try:
        await redis.publish(control_channel, control_signal)
        return {"published": control_signal}
    except Exception as e:
        logger.warning(f"Failed to publish control signal for {agent_run_id}: {e}")
        return {"published": None, "error": str(e)}
