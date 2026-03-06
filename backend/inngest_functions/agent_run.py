"""Agent execution via Inngest.

Replaces the Dramatiq-based run_agent_background actor with a durable
Inngest function. The Redis-based SSE streaming pipeline is unchanged —
this function simply replaces Dramatiq as the executor that pushes
responses into Redis.
"""

import asyncio
import json
import traceback
import uuid
from datetime import UTC, datetime, timedelta

import inngest

from services.inngest_client import inngest_client
from utils.logger import logger, structlog

# TTL for Redis response lists and task status keys (24 hours)
REDIS_RESPONSE_LIST_TTL = 3600 * 24

# Prune after every N responses to prevent memory bloat
PRUNE_CHECK_INTERVAL = 1000

# Minimum interval between Redis publish notifications (seconds).
# Responses are still pushed immediately via rpush; only the pub/sub
# notification to the SSE consumer is debounced to reduce command volume.
PUBLISH_DEBOUNCE_SECONDS = 0.1


async def _on_agent_run_failure(ctx: inngest.Context) -> None:
    """Handle permanent agent run failure (start timeout, infra error, etc.)."""
    event_data = ctx.event.data.get("event", {}).get("data", {})
    agent_run_id = event_data.get("agent_run_id", "unknown")
    error_msg = ctx.event.data.get("error", {}).get("message", "unknown")

    logger.error(f"Agent run permanently failed: {agent_run_id} error={error_msg}")

    try:
        from services import redis
        from services.supabase import DBConnection

        await redis.initialize_async()
        db_conn = DBConnection()
        await db_conn.initialize()
        client = await db_conn.client

        await update_agent_run_status(client, agent_run_id, "failed", error=f"Inngest execution failed: {error_msg}")

        control_channel = f"agent_run:{agent_run_id}:control"
        await redis.publish(control_channel, "ERROR")
        await _update_task_status(agent_run_id, "failed", {"error": error_msg})
    except Exception as e:
        logger.error(f"on_failure cleanup failed for {agent_run_id}: {e}")


@inngest_client.create_function(
    fn_id="process-agent-run",
    trigger=inngest.TriggerEvent(event="agent/run.requested"),
    retries=0,
    singleton=inngest.Singleton(
        mode="cancel",
        key="event.data.project_id",
    ),
    concurrency=[
        inngest.Concurrency(limit=1, key="event.data.agent_run_id"),
    ],
    idempotency="event.data.agent_run_id",
    cancel=[
        inngest.Cancel(
            event="agent/run.stop",
            if_exp="event.data.agent_run_id == async.data.agent_run_id",
        ),
    ],
    on_failure=_on_agent_run_failure,
    timeouts=inngest.Timeouts(
        start=timedelta(seconds=60),
        finish=timedelta(minutes=22),
    ),
    priority=inngest.Priority(run="event.data.priority"),
    throttle=inngest.Throttle(
        limit=20,
        period=timedelta(seconds=60),
        burst=5,
    ),
)
async def process_agent_run(ctx: inngest.Context) -> dict:
    """Execute an agent run, streaming responses to Redis.

    Event payload (minimal — no secrets):
        agent_run_id, thread_id, project_id, instance_id

    All other config (model, MCP credentials, etc.) is loaded from DB.
    """
    agent_run_id = ctx.event.data["agent_run_id"]
    thread_id = ctx.event.data["thread_id"]
    project_id = ctx.event.data["project_id"]
    instance_id = ctx.event.data.get("instance_id", "inngest")

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
        thread_id=thread_id,
    )

    # Lazy imports to avoid circular dependencies at module load time
    import sentry
    from agent.run import run_agent
    from services import redis
    from services.langfuse import langfuse, safe_trace
    from services.supabase import DBConnection
    from utils.config import config
    from utils.encryption import decrypt_data
    from utils.retry import retry

    # Self-initialize: ensure Redis and DB are ready
    await retry(lambda: redis.initialize_async())
    db_conn = DBConnection()
    await db_conn.initialize()
    client = await db_conn.client

    # ---- Load run config from DB ----

    run_result = await client.table("agent_runs").select("metadata").eq("run_id", agent_run_id).execute()
    if not run_result.data:
        raise RuntimeError(f"Agent run {agent_run_id} not found in database")

    metadata = run_result.data[0].get("metadata", {})
    model_name = metadata.get("model_name", config.MODEL_TO_USE)
    enable_thinking = metadata.get("enable_thinking")
    reasoning_effort = metadata.get("reasoning_effort")
    enable_context_manager = metadata.get("enable_context_manager", False)
    stream = metadata.get("stream", True)
    app_type = metadata.get("app_type", "web")
    request_id = metadata.get("request_id") or str(uuid.uuid4())
    mcp_profile_ids = metadata.get("mcp_profile_ids", [])

    structlog.contextvars.bind_contextvars(request_id=request_id)
    sentry.sentry.set_tag("thread_id", thread_id)

    logger.info(f"Starting Inngest agent run: {agent_run_id} for thread: {thread_id}")
    logger.info(f"Model: {model_name} (thinking: {enable_thinking}, reasoning: {reasoning_effort})")
    logger.info(f"App type: {app_type}")

    # ---- Build agent_config (MCP credentials decrypted at runtime) ----

    project_result = await client.table("projects").select("user_id").eq("project_id", project_id).execute()
    account_id = project_result.data[0]["user_id"] if project_result.data else None

    agent_config = {
        "name": "Coding Agent",
        "description": "Specialized agent for webapp development with 100+ UI components",
        "system_prompt": "",
        "configured_mcps": [],
        "account_id": account_id,
    }

    if mcp_profile_ids and account_id:
        try:
            cred_profiles_result = (
                await client.table("user_mcp_credential_profiles")
                .select("profile_id, mcp_qualified_name, display_name, encrypted_config")
                .in_("profile_id", mcp_profile_ids)
                .eq("user_id", account_id)
                .eq("is_active", True)
                .execute()
            )

            if cred_profiles_result.data:
                for profile in cred_profiles_result.data:
                    try:
                        decrypted_config = await asyncio.to_thread(decrypt_data, profile["encrypted_config"])
                        config_data = json.loads(decrypted_config)
                    except Exception as e:
                        logger.error(f"Failed to decrypt config for profile {profile['profile_id']}: {e}")
                        config_data = {}

                    clean_server_name = profile["mcp_qualified_name"]
                    if ":" in clean_server_name:
                        clean_server_name = clean_server_name.split(":", 1)[1]

                    agent_config["configured_mcps"].append(
                        {
                            "name": clean_server_name,
                            "qualifiedName": clean_server_name,
                            "provider": "composio",
                            "config": config_data,
                            "enabledTools": [],
                            "instructions": f"Use {profile['display_name']} integration",
                            "isCustom": False,
                        }
                    )

                logger.info(f"Loaded {len(agent_config['configured_mcps'])} MCP profiles for agent run")
        except Exception as e:
            logger.error(f"Failed to load MCP credentials: {e}")

    # ---- Observability ----

    trace = safe_trace(
        name="agent_run",
        id=agent_run_id,
        session_id=thread_id,
        metadata={
            "project_id": project_id,
            "instance_id": instance_id,
            "model_name": model_name,
            "enable_thinking": enable_thinking,
            "reasoning_effort": reasoning_effort,
            "enable_context_manager": enable_context_manager,
        },
    )

    # ---- Redis keys ----

    response_list_key = f"agent_run:{agent_run_id}:responses"
    response_channel = f"agent_run:{agent_run_id}:new_response"
    global_control_channel = f"agent_run:{agent_run_id}:control"
    instance_active_key = f"active_run:{instance_id}:{agent_run_id}"

    # ---- Execution state ----

    start_time = datetime.now(UTC)
    total_responses = 0
    last_publish_time = 0.0  # Monotonic time of last publish notification
    pubsub = None
    stop_checker = None
    stop_signal_received = False
    pending_redis_operations = []
    final_status = "running"
    error_message = None

    async def check_for_stop_signal():
        nonlocal stop_signal_received
        if not pubsub:
            return
        try:
            while not stop_signal_received:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.5)
                if message and message.get("type") == "message":
                    data = message.get("data")
                    if isinstance(data, bytes):
                        data = data.decode("utf-8")
                    if data == "STOP":
                        logger.info(f"Received STOP signal for agent run {agent_run_id}")
                        stop_signal_received = True
                        break
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            logger.info(f"Stop signal checker cancelled for {agent_run_id}")
        except Exception as e:
            logger.error(f"Error in stop signal checker: {e}", exc_info=True)
            stop_signal_received = True

    # ---- Main execution loop ----

    try:
        await _update_task_status(agent_run_id, "running")

        # Subscribe to control channel for stop signals
        pubsub = await redis.create_pubsub()
        await retry(lambda: pubsub.subscribe(global_control_channel))
        stop_checker = asyncio.create_task(check_for_stop_signal())

        # Mark this run as active
        await redis.set(instance_active_key, "running", ex=redis.REDIS_KEY_TTL)

        # Initialize agent generator
        agent_gen = run_agent(
            thread_id=thread_id,
            project_id=project_id,
            stream=stream,
            model_name=model_name,
            enable_thinking=enable_thinking,
            reasoning_effort=reasoning_effort,
            enable_context_manager=enable_context_manager,
            agent_config=agent_config,
            trace=trace,
            app_type=app_type,
        )

        async for response in agent_gen:
            if stop_signal_received:
                logger.info(f"Agent run {agent_run_id} stopped by signal.")
                final_status = "stopped"
                trace.start_span(name="agent_run_stopped").end(status_message="agent_run_stopped", level="WARNING")
                break

            # Timeout check (soft limit — Inngest has 22min hard limit)
            elapsed = (datetime.now(UTC) - start_time).total_seconds()
            if elapsed > config.MAX_AGENT_RUN_DURATION:
                logger.warning(f"Agent run {agent_run_id} exceeded timeout ({config.MAX_AGENT_RUN_DURATION}s)")
                timeout_msg = {
                    "type": "status",
                    "status": "completed",
                    "message": "Agent run timed out after maximum duration",
                }
                await redis.rpush(response_list_key, json.dumps(timeout_msg))
                await redis.publish(response_channel, "new")
                final_status = "completed"
                trace.start_span(name="agent_run_timeout").end(status_message="timeout", level="WARNING")
                break

            # Push response to Redis immediately; debounce the publish notification
            response_json = json.dumps(response)
            pending_redis_operations.append(asyncio.create_task(redis.rpush(response_list_key, response_json)))
            total_responses += 1

            # Debounce publish: only notify the SSE consumer if enough time
            # has elapsed since the last notification, or if this is a
            # terminal status message that the consumer must see immediately.
            now = asyncio.get_event_loop().time()
            is_terminal = response.get("type") == "status" and response.get("status") in {
                "completed",
                "failed",
                "stopped",
            }
            if is_terminal or (now - last_publish_time) >= PUBLISH_DEBOUNCE_SECONDS:
                pending_redis_operations.append(asyncio.create_task(redis.publish(response_channel, "new")))
                last_publish_time = now

            # Periodic pruning
            if total_responses % PRUNE_CHECK_INTERVAL == 0:
                pruned = await redis.prune_response_list(response_list_key)
                if pruned > 0:
                    logger.debug(f"Pruned {pruned} old responses from {response_list_key}")

            # Check for agent-signaled completion or error
            if response.get("type") == "status":
                status_val = response.get("status")
                if status_val in ["completed", "failed", "stopped"]:
                    logger.info(f"Agent run {agent_run_id} finished via status message: {status_val}")
                    final_status = status_val
                    if status_val in {"failed", "stopped"}:
                        error_message = response.get("message", f"Run ended with status: {status_val}")
                    break

        # Generator exhausted without explicit status → completed
        if final_status == "running":
            final_status = "completed"
            duration = (datetime.now(UTC) - start_time).total_seconds()
            logger.info(f"Agent run {agent_run_id} completed normally ({duration:.2f}s, {total_responses} responses)")
            completion_message = {
                "type": "status",
                "status": "completed",
                "message": "Agent run completed successfully",
            }
            trace.start_span(name="agent_run_completed").end(status_message="agent_run_completed", level="DEFAULT")
            await redis.rpush(response_list_key, json.dumps(completion_message))
            await redis.publish(response_channel, "new")

        # Persist final responses to DB
        all_responses_json = await redis.lrange(response_list_key, 0, -1)
        all_responses = [json.loads(r) for r in all_responses_json]
        await update_agent_run_status(client, agent_run_id, final_status, error=error_message, responses=all_responses)

        # Publish final control signal
        control_signal = (
            "END_STREAM" if final_status == "completed" else "ERROR" if final_status == "failed" else "STOP"
        )
        try:
            await redis.publish(global_control_channel, control_signal)
        except Exception as e:
            logger.warning(f"Failed to publish final control signal: {e!s}")

        try:
            await _update_task_status(agent_run_id, final_status)
        except Exception as e:
            logger.warning(f"Failed to update task status: {e}")

    except asyncio.CancelledError:
        logger.info(f"Agent run {agent_run_id} cancelled (singleton or stop event)")
        final_status = "stopped"
        error_message = "Run cancelled by newer request"

    except Exception as e:
        error_message = str(e)
        traceback_str = traceback.format_exc()
        duration = (datetime.now(UTC) - start_time).total_seconds()
        logger.error(f"Error in agent run {agent_run_id} after {duration:.2f}s: {error_message}\n{traceback_str}")
        final_status = "failed"
        trace.start_span(name="agent_run_failed").end(status_message=error_message, level="ERROR")

        # Push error to Redis for SSE consumers
        error_response = {"type": "status", "status": "error", "message": error_message}
        try:
            await redis.rpush(response_list_key, json.dumps(error_response))
            await redis.publish(response_channel, "new")
        except Exception as redis_err:
            logger.error(f"Failed to push error response to Redis: {redis_err}")

        # Persist to DB
        all_responses = []
        try:
            all_responses_json = await redis.lrange(response_list_key, 0, -1)
            all_responses = [json.loads(r) for r in all_responses_json]
        except Exception:
            all_responses = [error_response]

        await update_agent_run_status(
            client,
            agent_run_id,
            "failed",
            error=f"{error_message}\n{traceback_str}",
            responses=all_responses,
        )

        try:
            await redis.publish(global_control_channel, "ERROR")
        except Exception as pub_err:
            logger.warning(f"Failed to publish ERROR signal: {pub_err!s}")

        try:
            await _update_task_status(agent_run_id, "failed", {"error": error_message})
        except Exception as ts_err:
            logger.warning(f"Failed to update task status: {ts_err}")

    finally:
        # ---- Robust cleanup with error isolation ----
        cleanup_errors = []

        # 1. Cancel stop signal checker
        try:
            if stop_checker and not stop_checker.done():
                stop_checker.cancel()
                try:  # noqa: SIM105 — suppress cannot work with await
                    await asyncio.wait_for(stop_checker, timeout=5.0)
                except (TimeoutError, asyncio.CancelledError):
                    pass
        except Exception as e:
            cleanup_errors.append(f"stop_checker: {e}")

        # 2. Close pubsub connection
        if pubsub:
            try:
                await asyncio.wait_for(pubsub.unsubscribe(), timeout=5.0)
                await asyncio.wait_for(pubsub.close(), timeout=5.0)
            except Exception as e:
                cleanup_errors.append(f"pubsub: {e}")

        # 3. Set TTL on response list (24h expiry)
        try:
            await redis.expire(response_list_key, REDIS_RESPONSE_LIST_TTL)
        except Exception as e:
            cleanup_errors.append(f"response TTL: {e}")

        # 4. Clean up instance active key
        try:
            await redis.delete(instance_active_key)
        except Exception as e:
            cleanup_errors.append(f"instance key: {e}")

        # 5. Flush Langfuse data
        try:
            if langfuse:
                await asyncio.wait_for(asyncio.to_thread(lambda: langfuse.flush()), timeout=10.0)
        except Exception as e:
            cleanup_errors.append(f"langfuse: {e}")

        # 6. Wait for pending Redis operations
        if pending_redis_operations:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*pending_redis_operations, return_exceptions=True),
                    timeout=30.0,
                )
            except Exception as e:
                cleanup_errors.append(f"pending ops: {e}")

        # 7. Clean up orphaned user messages on failure
        if final_status == "failed":
            try:
                agent_run_data = (
                    await client.table("agent_runs").select("metadata, started_at").eq("run_id", agent_run_id).execute()
                )
                if agent_run_data.data:
                    run_metadata = agent_run_data.data[0].get("metadata", {})
                    triggering_message_id = run_metadata.get("triggering_message_id")
                    run_started_at = agent_run_data.data[0].get("started_at")

                    if triggering_message_id:
                        assistant_msgs = (
                            await client.table("messages")
                            .select("message_id")
                            .eq("thread_id", thread_id)
                            .eq("type", "assistant")
                            .gte("created_at", run_started_at)
                            .limit(1)
                            .execute()
                        )
                        if not assistant_msgs.data:
                            await client.table("messages").delete().eq("message_id", triggering_message_id).execute()
                            logger.info(f"Cleaned up orphaned user message {triggering_message_id}")
            except Exception as e:
                cleanup_errors.append(f"message cleanup: {e}")

        if cleanup_errors:
            logger.warning(
                f"Agent run {agent_run_id} cleanup had {len(cleanup_errors)} errors: {'; '.join(cleanup_errors)}"
            )
        else:
            logger.info(f"Agent run {agent_run_id} cleanup completed successfully")

        # 8. Emit agent/run.finished event for durable finalization safety net
        try:
            from services.inngest_client import inngest_client as _client

            await _client.send(
                inngest.Event(
                    name="agent/run.finished",
                    data={
                        "agent_run_id": agent_run_id,
                        "thread_id": thread_id,
                        "project_id": project_id,
                        "account_id": account_id,
                        "expected_status": final_status,
                        "error_message": error_message,
                        "total_responses": total_responses,
                        "duration_seconds": (datetime.now(UTC) - start_time).total_seconds(),
                        "model_name": model_name,
                    },
                )
            )
        except Exception as e:
            logger.warning(f"Failed to emit agent/run.finished event: {e}")

    return {
        "agent_run_id": agent_run_id,
        "status": final_status,
        "total_responses": total_responses,
    }


# ===========================================================================
# Utility functions — importable by agent/api.py and other modules
# ===========================================================================


async def _update_task_status(agent_run_id: str, status: str, data: dict | None = None):
    """Write task status to Redis for retrieval via API."""
    from services import redis

    key = f"task_status:{agent_run_id}"
    payload = {
        "status": status,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    if data:
        payload["data"] = data
    try:
        await redis.set(key, json.dumps(payload), ex=REDIS_RESPONSE_LIST_TTL)
    except Exception as e:
        logger.warning(f"Failed to set task status in Redis for {agent_run_id}: {e}")


async def get_task_status(agent_run_id: str):
    """Read task status from Redis; return None if not found."""
    from services import redis

    key = f"task_status:{agent_run_id}"
    try:
        val = await redis.get(key)
        if not val:
            return None
        if isinstance(val, bytes):
            val = val.decode("utf-8")
        return json.loads(val)
    except Exception as e:
        logger.warning(f"Failed to read task status from Redis for {agent_run_id}: {e}")
        return None


async def update_agent_run_status(
    client,
    agent_run_id: str,
    status: str,
    error: str | None = None,
    responses: list | None = None,
) -> bool:
    """Update agent run status in the database with retry."""
    try:
        update_data = {"status": status, "completed_at": datetime.now(UTC).isoformat()}
        if error:
            update_data["error"] = error
        if responses:
            update_data["responses"] = responses

        for attempt in range(3):
            try:
                update_result = (
                    await client.table("agent_runs").update(update_data).eq("run_id", agent_run_id).execute()
                )
                if hasattr(update_result, "data") and update_result.data:
                    logger.info(f"Updated agent run {agent_run_id} status to '{status}'")
                    return True
                if attempt == 2:
                    logger.error(f"Failed to update agent run status after all retries: {agent_run_id}")
                    return False
            except Exception as db_error:
                logger.error(f"DB error on retry {attempt}: {db_error!s}")
                if attempt < 2:
                    await asyncio.sleep(0.5 * (2**attempt))
                else:
                    return False
    except Exception as e:
        logger.exception(f"Unexpected error updating agent run status for {agent_run_id}: {e!s}")
        return False
    return False


async def stop_agent_run(agent_run_id: str, instance_id: str | None = None):
    """Send a STOP signal to a running agent via Redis pub/sub.

    Args:
        agent_run_id: The ID of the agent run to stop.
        instance_id: Optional specific instance ID to target.

    """
    from services import redis

    try:
        if instance_id:
            control_channel = f"agent_run:{agent_run_id}:control:{instance_id}"
            await redis.publish(control_channel, "STOP")
            logger.info(f"Sent STOP signal to instance {instance_id} for agent run {agent_run_id}")
        else:
            global_control_channel = f"agent_run:{agent_run_id}:control"
            await redis.publish(global_control_channel, "STOP")
            logger.info(f"Sent STOP signal for agent run {agent_run_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to send STOP signal for agent run {agent_run_id}: {e}")
        return False
