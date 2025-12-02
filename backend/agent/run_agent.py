import dotenv

dotenv.load_dotenv(".env")

import sentry
import asyncio
import traceback
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, AsyncIterable
from services import redis
from agent.run import run_agent
from utils.logger import logger, structlog
import uuid
from services.supabase import DBConnection
from services.langfuse import langfuse, safe_trace
from utils.retry import retry
from typing import AsyncGenerator
import json


_initialized = False
instance_id = "single"





async def initialize():
    """Initialize the agent API with resources from the main API."""
    global instance_id, _initialized

    if not instance_id:
        instance_id = str(uuid.uuid4())[:8]
    await retry(lambda: redis.initialize_async())

    _initialized = True
    logger.info(f"Initialized agent API with instance ID: {instance_id}")


async def run_agent_run_stream(
    agent_run_id: str,
    thread_id: str,
    instance_id: str,
    project_id: str,
    model_name: str,
    enable_thinking: Optional[bool],
    reasoning_effort: Optional[str],
    stream: bool,
    enable_context_manager: bool,
    agent_config: Optional[dict] = None,
    request_id: Optional[str] = None,
) -> AsyncGenerator[Dict[Any, Any], None]:
    """Run the agent in the background and yield responses as they come."""
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
        thread_id=thread_id,
        request_id=request_id,
    )

    try:
        await initialize()
        db = DBConnection()
        await db.initialize()
    except Exception as e:
        logger.critical(f"Failed to initialize: {e}")
        raise e

    sentry.sentry.set_tag("thread_id", thread_id)

    logger.info(
        f"Starting agent run: {agent_run_id} for thread: {thread_id} (Instance: {instance_id})"
    )
    logger.info(
        {
            "model_name": model_name,
            "enable_thinking": enable_thinking,
            "reasoning_effort": reasoning_effort,
            "stream": stream,
            "enable_context_manager": enable_context_manager,
            "agent_config": agent_config,
        }
    )
    logger.info(
        f"🚀 Using model: {model_name} (thinking: {enable_thinking}, reasoning_effort: {reasoning_effort})"
    )
    if agent_config:
        logger.info(f"Using custom agent: {agent_config.get('name', 'Unknown')}")

    client = await db.client
    start_time = datetime.now(timezone.utc)
    all_responses = []  # Keep for DB updates

    trace = safe_trace(
        name="agent_run",
        id=agent_run_id,
        session_id=thread_id,
        metadata={"project_id": project_id, "instance_id": instance_id},
    )

    stop_event = asyncio.Event()
    stop_channel = f"stop_channel:{agent_run_id}"

    async def listen_for_stop_signal():
        """Listen for stop signals via Redis pub/sub."""
        try:
            pubsub = await redis.create_pubsub()
            await pubsub.subscribe(stop_channel)
            logger.info(f"Subscribed to stop channel: {stop_channel} (Instance: {instance_id})")
            
            async for message in pubsub.listen():
                if message['type'] == 'message' and message['data'] == 'STOP':
                    logger.info(
                        f"Received STOP signal for agent run {agent_run_id} (Instance: {instance_id})"
                    )
                    stop_event.set()
                    break
        except asyncio.CancelledError:
            logger.info(
                f"Stop signal listener cancelled for {agent_run_id} (Instance: {instance_id})"
            )
        except Exception as e:
            logger.error(
                f"Error in stop signal listener for {agent_run_id}: {e}", exc_info=True
            )
            stop_event.set()  # Stop the run if the listener fails
        finally:
            try:
                await pubsub.unsubscribe(stop_channel)
                await pubsub.aclose()
            except Exception as e:
                logger.debug(f"Error closing pubsub connection: {e}")

    listener_task = asyncio.create_task(listen_for_stop_signal())

    try:
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
        )

        final_status = "running"
        error_message = None

        # Yield responses from the agent stream
        async for response in agent_gen:
            if stop_event.is_set():
                logger.info(f"Agent run {agent_run_id} stopped by signal.")
                final_status = "stopped"
                trace.span(name="agent_run_stopped").end(
                    status_message="agent_run_stopped", level="WARNING"
                )
                break

            all_responses.append(response)  # Keep for DB updates
            if isinstance(response, dict):
                yield f"data: {json.dumps(response)}\n\n"
            else:
                yield f"data: {response}\n\n"

            # Check for agent-signaled completion or error
            if response.get("type") == "status":
                status_val = response.get("status")
                if status_val in ["completed", "failed", "stopped"]:
                    logger.info(
                        f"Agent run {agent_run_id} finished via status message: {status_val}"
                    )
                    final_status = status_val
                    if status_val == "failed" or status_val == "stopped":
                        error_message = response.get(
                            "message", f"Run ended with status: {status_val}"
                        )
                    break

        # If loop finished without explicit completion/error, mark as completed
        if final_status == "running":
            final_status = "completed"
            duration = (datetime.now(timezone.utc) - start_time).total_seconds()
            logger.info(
                f"Agent run {agent_run_id} completed normally (duration: {duration:.2f}s, responses: {len(all_responses)})"
            )
            completion_message = {
                "type": "status",
                "status": "completed",
                "message": "Agent run completed successfully",
            }
            trace.span(name="agent_run_completed").end(
                status_message="agent_run_completed"
            )
            all_responses.append(completion_message)
            yield f"data: {json.dumps(completion_message)}\n\n"

        # Update DB status
        await update_agent_run_status(
            client,
            agent_run_id,
            final_status,
            error=error_message,
            responses=all_responses,
        )

    except Exception as e:
        error_message = str(e)
        traceback_str = traceback.format_exc()
        duration = (datetime.now(timezone.utc) - start_time).total_seconds()
        logger.error(
            f"Error in agent run {agent_run_id} after {duration:.2f}s: {error_message}\n{traceback_str} (Instance: {instance_id})"
        )
        final_status = "failed"
        trace.span(name="agent_run_failed").end(
            status_message=error_message, level="ERROR"
        )

        # Add and yield error response
        error_response = {"type": "status", "status": "error", "message": error_message}
        all_responses.append(error_response)
        yield f"data: {json.dumps(error_response)}\n\n"

        # Update DB status
        await update_agent_run_status(
            client,
            agent_run_id,
            "failed",
            error=f"{error_message}\n{traceback_str}",
            responses=all_responses,
        )

    finally:
        # Clean up the listener task
        try:
            listener_task.cancel()
            await listener_task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"Error cancelling listener task: {e}")

        instance_key = f"active_run:{instance_id}:{agent_run_id}"
        await redis.client.delete(instance_key)
        logger.info(
            f"Agent run completed for: {agent_run_id} (Instance: {instance_id}) with final status: {final_status}"
        )
        
        # Traces auto-complete in Langfuse - no need to manually end them
        try:
            if trace:
                logger.debug("Langfuse trace will auto-complete")
        except Exception as trace_error:
            logger.warning(f"Error with Langfuse trace: {str(trace_error)}")
        
        # Flush Langfuse data asynchronously
        try:
            if langfuse:
                asyncio.create_task(asyncio.to_thread(lambda: langfuse.flush()))
        except Exception as flush_error:
            logger.warning(f"Error flushing Langfuse data in agent run stream: {str(flush_error)}")


async def update_agent_run_status(
    client,
    agent_run_id: str,
    status: str,
    error: Optional[str] = None,
    responses: Optional[List[Dict[Any, Any]]] = None,
) -> bool:
    """
    Centralized function to update agent run status.
    Returns True if update was successful.
    """
    try:
        # Debug log to trace function calls
        logger.debug(f"update_agent_run_status called with agent_run_id={agent_run_id}, status={status}")
        
        # Validate UUID format to prevent database errors
        if not isinstance(agent_run_id, str):
            logger.error(f"agent_run_id must be a string, got {type(agent_run_id)}: {agent_run_id}")
            return False
        
        try:
            uuid.UUID(agent_run_id)
        except (ValueError, TypeError) as e:
            logger.error(f"Invalid UUID format for agent_run_id: {agent_run_id}, error: {str(e)}")
            return False
        
        update_data = {
            "status": status,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

        if error:
            update_data["error"] = error

        if responses:
            # Ensure responses are stored correctly as JSONB
            update_data["responses"] = responses

        # Retry up to 3 times
        for retry in range(3):
            try:
                # Additional validation before database query
                if not isinstance(status, str):
                    logger.error(f"Status must be a string, got {type(status)}: {status}")
                    return False
                
                if error is not None and not isinstance(error, str):
                    logger.error(f"Error must be a string or None, got {type(error)}: {error}")
                    # Convert to string instead of failing
                    error = str(error)
                    update_data["error"] = error
                
                update_result = (
                    await client.table("agent_runs")
                    .update(update_data)
                    .eq("run_id", agent_run_id)
                    .execute()
                )

                if hasattr(update_result, "data") and update_result.data:
                    logger.info(
                        f"Successfully updated agent run {agent_run_id} status to '{status}' (retry {retry})"
                    )

                    # Verify the update
                    try:
                        verify_result = (
                            await client.table("agent_runs")
                            .select("status", "completed_at")
                            .eq("run_id", agent_run_id)
                            .execute()
                        )
                        if verify_result.data:
                            actual_status = verify_result.data[0].get("status")
                            completed_at = verify_result.data[0].get("completed_at")
                            logger.info(
                                f"Verified agent run update: status={actual_status}, completed_at={completed_at}"
                            )
                        return True
                    except Exception as verify_error:
                        logger.warning(f"Failed to verify update for {agent_run_id}: {str(verify_error)}")
                        # Still return True since the main update succeeded
                        return True
                else:
                    logger.warning(
                        f"Database update returned no data for agent run {agent_run_id} on retry {retry}: {update_result}"
                    )
                    if retry == 2:  # Last retry
                        logger.error(
                            f"Failed to update agent run status after all retries: {agent_run_id}"
                        )
                        return False
            except Exception as db_error:
                # Ensure proper string conversion to avoid concatenation errors
                try:
                    if hasattr(db_error, 'message'):
                        error_str = str(db_error.message)
                    elif hasattr(db_error, 'details'):
                        error_str = str(db_error.details)
                    elif isinstance(db_error, dict):
                        error_str = json.dumps(db_error)
                    else:
                        error_str = str(db_error)
                except Exception:
                    error_str = f"Error converting database error to string: {type(db_error)}"
                
                logger.error(
                    f"Database error on retry {retry} updating status for {agent_run_id}: {error_str}"
                )
                if retry < 2:  # Not the last retry yet
                    await asyncio.sleep(0.5 * (2**retry))  # Exponential backoff
                else:
                    # Convert exception to string to avoid concatenation errors in structlog
                    import traceback
                    error_details = traceback.format_exc()
                    logger.error(
                        f"Failed to update agent run status after all retries: {agent_run_id}. Error details: {error_details}"
                    )
                    return False
    except Exception as e:
        # Convert exception to string to avoid concatenation errors in structlog
        import traceback
        error_details = traceback.format_exc()
        logger.error(
            f"Unexpected error updating agent run status for {agent_run_id}: {str(e)}. Error details: {error_details}"
        )
        return False

    return False
