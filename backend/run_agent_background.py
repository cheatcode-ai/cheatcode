import dotenv
dotenv.load_dotenv(".env")

import sentry
import asyncio
import json
import traceback
import time
from datetime import datetime, timezone
from typing import Optional
from services import redis
from agent.run import run_agent
from utils.logger import logger, structlog
import dramatiq
import uuid
from services.supabase import DBConnection
from dramatiq.brokers.redis import RedisBroker
import os
from utils.retry import retry
from services.langfuse import langfuse, safe_trace
from utils.concurrency_monitor import get_monitor, start_monitoring_task
from utils.health_check import get_health_checker, start_health_monitoring

# Redis Configuration for Dramatiq
# Use Upstash Redis URL for Dramatiq broker
redis_url = os.getenv('REDIS_URL')

if not redis_url:
    raise ValueError("REDIS_URL environment variable is required")

broker_kwargs = {
    "url": redis_url,
    "namespace": "dramatiq",
    "middleware": [dramatiq.middleware.AsyncIO()],
    # Reduce heartbeat frequency to minimize Redis noise
    "heartbeat_timeout": 60000,  # 60 seconds instead of default 15
    # Reduce queue polling frequency 
    "requeue_interval": 10000,   # 10 seconds instead of default 5
}

redis_broker = RedisBroker(**broker_kwargs)
dramatiq.set_broker(redis_broker)

_initialized = False
db = DBConnection()
instance_id = "single"

async def initialize():
    """Initialize the agent API with resources from the main API."""
    global db, instance_id, _initialized

    if not instance_id:
        instance_id = str(uuid.uuid4())[:8]
    await retry(lambda: redis.initialize_async())
    await db.initialize()

    # Initialize concurrency monitoring
    monitor = get_monitor(instance_id)
    # Start background monitoring tasks
    asyncio.create_task(start_monitoring_task(instance_id))
    
    # Initialize health monitoring
    health_checker = get_health_checker(instance_id)
    asyncio.create_task(start_health_monitoring(instance_id))
    
    _initialized = True
    logger.info(f"Initialized agent API with instance ID: {instance_id} with concurrency monitoring")

@dramatiq.actor
async def check_health(key: str):
    """Run the agent in the background using Redis for state."""
    structlog.contextvars.clear_contextvars()
    await redis.set(key, "healthy", ex=redis.REDIS_KEY_TTL)



@dramatiq.actor
async def run_agent_background(
    agent_run_id: str,
    thread_id: str,
    instance_id: str, # Use the global instance ID passed during initialization
    project_id: str,
    model_name: str,
    enable_thinking: Optional[bool],
    reasoning_effort: Optional[str],
    stream: bool,
    enable_context_manager: bool,
    agent_config: Optional[dict] = None,
    is_agent_builder: Optional[bool] = False,
    target_agent_id: Optional[str] = None,
    request_id: Optional[str] = None,
    app_type: Optional[str] = 'web',
):
    """Run the agent in the background using Redis for state."""
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
        thread_id=thread_id,
        request_id=request_id,
    )

    try:
        await initialize()
    except Exception as e:
        logger.critical(f"Failed to initialize Redis connection: {e}")
        raise e

    # Idempotency check: prevent duplicate runs with atomic lock acquisition
    run_lock_key = f"agent_run_lock:{agent_run_id}"
    lock_value = f"{instance_id}:{int(time.time())}"
    
    # Atomic lock acquisition with monitoring
    from utils.concurrency_monitor import monitored_lock
    client = await redis.get_client()
    lock_acquired = await monitored_lock(
        run_lock_key,
        "agent_run_execution",
        client,
        lock_value,
        timeout=redis.REDIS_KEY_TTL,
        metadata={
            "agent_run_id": agent_run_id,
            "thread_id": thread_id,
            "model_name": model_name,
            "app_type": app_type
        }
    )
    
    if not lock_acquired:
        # Check if lock is stale (older than TTL/2) and try to reclaim
        existing_value = await redis.get(run_lock_key)
        if existing_value:
            try:
                existing_instance, existing_timestamp = existing_value.split(':', 1)
                existing_time = int(existing_timestamp)
                current_time = int(time.time())
                
                # If lock is more than half TTL old, it might be stale
                if current_time - existing_time > (redis.REDIS_KEY_TTL // 2):
                    logger.warning(f"Detected potentially stale lock for {agent_run_id} from instance {existing_instance}")
                    # Try to reclaim with conditional update
                    reclaim_script = """
                    if redis.call('GET', KEYS[1]) == ARGV[1] then
                        return redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
                    else
                        return nil
                    end
                    """
                    client = await redis.get_client()
                    result = await client.eval(reclaim_script, 1, run_lock_key, existing_value, lock_value, redis.REDIS_KEY_TTL)
                    if result:
                        logger.info(f"Successfully reclaimed stale lock for {agent_run_id}")
                        lock_acquired = True
                    else:
                        logger.info(f"Failed to reclaim lock for {agent_run_id}, another instance updated it")
                        return
                else:
                    logger.info(f"Agent run {agent_run_id} is being processed by instance {existing_instance}. Skipping duplicate execution.")
                    return
            except (ValueError, AttributeError) as e:
                logger.warning(f"Invalid lock value format for {agent_run_id}: {existing_value}. Error: {e}")
                return
        else:
            # No existing value but lock failed, another process is faster
            logger.info(f"Agent run {agent_run_id} lock acquisition failed, another instance is processing.")
            return
    
    if not lock_acquired:
        logger.info(f"Failed to acquire lock for agent run {agent_run_id}, skipping execution.")
        return

    sentry.sentry.set_tag("thread_id", thread_id)

    logger.info(f"Starting background agent run: {agent_run_id} for thread: {thread_id} (Instance: {instance_id})")
    logger.info({
        "model_name": model_name,
        "enable_thinking": enable_thinking,
        "reasoning_effort": reasoning_effort,
        "stream": stream,
        "enable_context_manager": enable_context_manager,
        "agent_config": agent_config,
        "is_agent_builder": is_agent_builder,
        "target_agent_id": target_agent_id,
    })
    logger.info(f"🚀 Using model: {model_name} (thinking: {enable_thinking}, reasoning_effort: {reasoning_effort})")
    logger.info(f"📱 App type: {app_type}")
    if agent_config:
        logger.info(f"Using custom agent: {agent_config.get('name', 'Unknown')}")

    client = await db.client
    start_time = datetime.now(timezone.utc)
    total_responses = 0
    pubsub = None
    stop_checker = None
    stop_signal_received = False

    # Define Redis keys and channels
    response_list_key = f"agent_run:{agent_run_id}:responses"
    response_channel = f"agent_run:{agent_run_id}:new_response"
    instance_control_channel = f"agent_run:{agent_run_id}:control:{instance_id}"
    global_control_channel = f"agent_run:{agent_run_id}:control"
    instance_active_key = f"active_run:{instance_id}:{agent_run_id}"

    async def check_for_stop_signal():
        nonlocal stop_signal_received
        if not pubsub: return
        try:
            while not stop_signal_received:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.5)
                if message and message.get("type") == "message":
                    data = message.get("data")
                    if isinstance(data, bytes): data = data.decode('utf-8')
                    if data == "STOP":
                        logger.info(f"Received STOP signal for agent run {agent_run_id} (Instance: {instance_id})")
                        stop_signal_received = True
                        break
                # Periodically refresh the active run key TTL
                if total_responses % 50 == 0: # Refresh every 50 responses or so
                    try: await redis.expire(instance_active_key, redis.REDIS_KEY_TTL)
                    except Exception as ttl_err: logger.warning(f"Failed to refresh TTL for {instance_active_key}: {ttl_err}")
                await asyncio.sleep(0.1) # Short sleep to prevent tight loop
        except asyncio.CancelledError:
            logger.info(f"Stop signal checker cancelled for {agent_run_id} (Instance: {instance_id})")
        except Exception as e:
            logger.error(f"Error in stop signal checker for {agent_run_id}: {e}", exc_info=True)
            stop_signal_received = True # Stop the run if the checker fails

    # Create Langfuse trace for observability
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
            "enable_context_manager": enable_context_manager
        }
    )
    
    try:
        # Update task status to running
        await _update_task_status(agent_run_id, "running")
        # Setup Pub/Sub listener for control signals
        pubsub = await redis.create_pubsub()
        try:
            await retry(lambda: pubsub.subscribe(instance_control_channel, global_control_channel))
        except Exception as e:
            logger.error(f"Redis failed to subscribe to control channels: {e}", exc_info=True)
            raise e

        logger.debug(f"Subscribed to control channels: {instance_control_channel}, {global_control_channel}")
        stop_checker = asyncio.create_task(check_for_stop_signal())

        # Ensure active run key exists and has TTL
        await redis.set(instance_active_key, "running", ex=redis.REDIS_KEY_TTL)


        # Initialize agent generator
        agent_gen = run_agent(
            thread_id=thread_id, project_id=project_id, stream=stream,
            model_name=model_name,
            enable_thinking=enable_thinking, reasoning_effort=reasoning_effort,
            enable_context_manager=enable_context_manager,
            agent_config=agent_config,
            trace=trace,
            is_agent_builder=is_agent_builder,
            target_agent_id=target_agent_id,
            app_type=app_type
        )

        final_status = "running"
        error_message = None

        pending_redis_operations = []

        async for response in agent_gen:
            if stop_signal_received:
                logger.info(f"Agent run {agent_run_id} stopped by signal.")
                final_status = "stopped"
                trace.span(name="agent_run_stopped").end(status_message="agent_run_stopped", level="WARNING")
                break

            # Store response in Redis list and publish notification
            response_json = json.dumps(response)
            pending_redis_operations.append(asyncio.create_task(redis.rpush(response_list_key, response_json)))
            pending_redis_operations.append(asyncio.create_task(redis.publish(response_channel, "new")))
            total_responses += 1

            # Check for agent-signaled completion or error
            if response.get('type') == 'status':
                 status_val = response.get('status')
                 if status_val in ['completed', 'failed', 'stopped']:
                     logger.info(f"Agent run {agent_run_id} finished via status message: {status_val}")
                     final_status = status_val
                     if status_val == 'failed' or status_val == 'stopped':
                         error_message = response.get('message', f"Run ended with status: {status_val}")
                     break

        # If loop finished without explicit completion/error/stop signal, mark as completed
        if final_status == "running":
             final_status = "completed"
             duration = (datetime.now(timezone.utc) - start_time).total_seconds()
             logger.info(f"Agent run {agent_run_id} completed normally (duration: {duration:.2f}s, responses: {total_responses})")
             
             # Git operations and deployment are now performed during explicit deploy
             # via the deployments API ('deploy_from_git'). No auto-initialization here.
             
             completion_message = {"type": "status", "status": "completed", "message": "Agent run completed successfully"}
             trace.span(name="agent_run_completed").end(status_message="agent_run_completed", level="DEFAULT")
             await redis.rpush(response_list_key, json.dumps(completion_message))
             await redis.publish(response_channel, "new") # Notify about the completion message

        # Fetch final responses from Redis for DB update
        all_responses_json = await redis.lrange(response_list_key, 0, -1)
        all_responses = [json.loads(r) for r in all_responses_json]

        # Update DB status
        await update_agent_run_status(client, agent_run_id, final_status, error=error_message, responses=all_responses)

        # Track agent response as message usage for billing (only for successful runs)
        if final_status == "completed":
            # Message usage tracking now handled by real-time token consumption in response_processor
            pass

        # Publish final control signal (END_STREAM or ERROR)
        control_signal = "END_STREAM" if final_status == "completed" else "ERROR" if final_status == "failed" else "STOP"
        try:
            await redis.publish(global_control_channel, control_signal)
            # No need to publish to instance channel as the run is ending on this instance
            logger.debug(f"Published final control signal '{control_signal}' to {global_control_channel}")
        except Exception as e:
            logger.warning(f"Failed to publish final control signal {control_signal}: {str(e)}")
        # Update task status to final
        try:
            await _update_task_status(agent_run_id, final_status)
        except Exception as e:
            logger.warning(f"Failed to update task status to {final_status} for {agent_run_id}: {e}")

    except Exception as e:
        error_message = str(e)
        traceback_str = traceback.format_exc()
        duration = (datetime.now(timezone.utc) - start_time).total_seconds()
        logger.error(f"Error in agent run {agent_run_id} after {duration:.2f}s: {error_message}\n{traceback_str} (Instance: {instance_id})")
        final_status = "failed"
        trace.span(name="agent_run_failed").end(status_message=error_message, level="ERROR")

        # Push error message to Redis list
        error_response = {"type": "status", "status": "error", "message": error_message}
        try:
            await redis.rpush(response_list_key, json.dumps(error_response))
            await redis.publish(response_channel, "new")
        except Exception as redis_err:
             logger.error(f"Failed to push error response to Redis for {agent_run_id}: {redis_err}")

        # Fetch final responses (including the error)
        all_responses = []
        try:
             all_responses_json = await redis.lrange(response_list_key, 0, -1)
             all_responses = [json.loads(r) for r in all_responses_json]
        except Exception as fetch_err:
             logger.error(f"Failed to fetch responses from Redis after error for {agent_run_id}: {fetch_err}")
             all_responses = [error_response] # Use the error message we tried to push

        # Update DB status
        await update_agent_run_status(client, agent_run_id, "failed", error=f"{error_message}\n{traceback_str}", responses=all_responses)

        # Publish ERROR signal
        try:
            await redis.publish(global_control_channel, "ERROR")
            logger.debug(f"Published ERROR signal to {global_control_channel}")
        except Exception as e:
            logger.warning(f"Failed to publish ERROR signal: {str(e)}")
        # Update task status to failed
        try:
            await _update_task_status(agent_run_id, "failed", {"error": error_message})
        except Exception as e:
            logger.warning(f"Failed to update task status to failed for {agent_run_id}: {e}")

    finally:
        # Robust cleanup with error isolation
        cleanup_errors = []
        
        # 1. Cleanup stop checker task
        try:
            if stop_checker and not stop_checker.done():
                stop_checker.cancel()
                try:
                    await asyncio.wait_for(stop_checker, timeout=5.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
                except Exception as e:
                    cleanup_errors.append(f"stop_checker cleanup: {e}")
        except Exception as e:
            cleanup_errors.append(f"stop_checker handling: {e}")

        # 2. Close pubsub connection with retry
        if pubsub:
            for attempt in range(3):  # Retry up to 3 times
                try:
                    await asyncio.wait_for(pubsub.unsubscribe(), timeout=5.0)
                    await asyncio.wait_for(pubsub.close(), timeout=5.0)
                    logger.debug(f"Closed pubsub connection for {agent_run_id}")
                    break
                except asyncio.TimeoutError:
                    if attempt == 2:
                        cleanup_errors.append(f"pubsub cleanup timeout after {attempt + 1} attempts")
                    else:
                        await asyncio.sleep(1.0)  # Wait before retry
                except Exception as e:
                    if attempt == 2:
                        cleanup_errors.append(f"pubsub cleanup: {e}")
                    else:
                        await asyncio.sleep(1.0)  # Wait before retry

        # 3. Parallel cleanup of Redis resources with individual error handling
        cleanup_tasks = []
        
        # Create cleanup tasks
        cleanup_tasks.append(asyncio.create_task(
            _robust_cleanup_redis_response_list(agent_run_id), name=f"cleanup_responses_{agent_run_id}"))
        cleanup_tasks.append(asyncio.create_task(
            _robust_cleanup_redis_instance_key(agent_run_id), name=f"cleanup_instance_{agent_run_id}"))
        cleanup_tasks.append(asyncio.create_task(
            _robust_cleanup_redis_run_lock(agent_run_id), name=f"cleanup_lock_{agent_run_id}"))
        
        # Wait for cleanup tasks with timeout
        try:
            results = await asyncio.wait_for(asyncio.gather(*cleanup_tasks, return_exceptions=True), timeout=30.0)
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    cleanup_errors.append(f"Redis cleanup task {i}: {result}")
        except asyncio.TimeoutError:
            cleanup_errors.append("Redis cleanup operations timed out")
            # Cancel remaining tasks
            for task in cleanup_tasks:
                if not task.done():
                    task.cancel()
        
        # 4. Flush Langfuse data with timeout
        try:
            if langfuse:
                # Use asyncio.to_thread with timeout for thread safety
                await asyncio.wait_for(
                    asyncio.to_thread(lambda: langfuse.flush()), 
                    timeout=10.0
                )
                logger.debug("Langfuse data flush completed")
        except asyncio.TimeoutError:
            cleanup_errors.append("Langfuse flush timeout")
        except Exception as flush_error:
            cleanup_errors.append(f"Langfuse flush error: {flush_error}")

        # 5. Wait for all pending Redis operations to complete, with timeout
        if pending_redis_operations:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*pending_redis_operations, return_exceptions=True), 
                    timeout=30.0
                )
                logger.debug(f"Completed {len(pending_redis_operations)} pending Redis operations")
            except asyncio.TimeoutError:
                cleanup_errors.append(f"Timeout waiting for {len(pending_redis_operations)} pending Redis operations")
            except Exception as e:
                cleanup_errors.append(f"Error completing pending Redis operations: {e}")

        # Log cleanup status
        if cleanup_errors:
            logger.warning(f"Agent run {agent_run_id} cleanup completed with {len(cleanup_errors)} errors: {'; '.join(cleanup_errors)}")
        else:
            logger.info(f"Agent run {agent_run_id} cleanup completed successfully")
            
        logger.info(f"Agent run background task fully completed for: {agent_run_id} (Instance: {instance_id}) with final status: {final_status}")

async def _cleanup_redis_instance_key(agent_run_id: str):
    """Clean up the instance-specific Redis key for an agent run."""
    if not instance_id:
        logger.warning("Instance ID not set, cannot clean up instance key.")
        return
    key = f"active_run:{instance_id}:{agent_run_id}"
    logger.debug(f"Cleaning up Redis instance key: {key}")
    try:
        await redis.delete(key)
        logger.debug(f"Successfully cleaned up Redis key: {key}")
    except Exception as e:
        logger.warning(f"Failed to clean up Redis key {key}: {str(e)}")

async def _robust_cleanup_redis_instance_key(agent_run_id: str):
    """Robust cleanup with retry logic for Redis instance key."""
    for attempt in range(3):
        try:
            await _cleanup_redis_instance_key(agent_run_id)
            return
        except Exception as e:
            if attempt == 2:
                logger.error(f"Failed to cleanup instance key after 3 attempts: {e}")
                raise
            await asyncio.sleep(1.0)

async def _cleanup_redis_run_lock(agent_run_id: str):
    """Clean up the run lock Redis key for an agent run with ownership verification."""
    run_lock_key = f"agent_run_lock:{agent_run_id}"
    expected_value = f"{instance_id}:"
    logger.debug(f"Cleaning up Redis run lock key: {run_lock_key}")
    try:
        # Only delete if we own the lock
        cleanup_script = """
        local current_value = redis.call('GET', KEYS[1])
        if current_value and string.find(current_value, ARGV[1]) == 1 then
            return redis.call('DEL', KEYS[1])
        else
            return 0
        end
        """
        client = await redis.get_client()
        result = await client.eval(cleanup_script, 1, run_lock_key, expected_value)
        if result:
            logger.debug(f"Successfully cleaned up Redis run lock key: {run_lock_key}")
        else:
            logger.debug(f"Lock {run_lock_key} not owned by this instance, skipping cleanup")
    except Exception as e:
        logger.warning(f"Failed to clean up Redis run lock key {run_lock_key}: {str(e)}")

async def _robust_cleanup_redis_run_lock(agent_run_id: str):
    """Robust cleanup with retry logic for Redis run lock."""
    for attempt in range(3):
        try:
            await _cleanup_redis_run_lock(agent_run_id)
            return
        except Exception as e:
            if attempt == 2:
                logger.error(f"Failed to cleanup run lock after 3 attempts: {e}")
                raise
            await asyncio.sleep(1.0)

# TTL for Redis response lists (24 hours)
REDIS_RESPONSE_LIST_TTL = 3600 * 24

async def _cleanup_redis_response_list(agent_run_id: str):
    """Set TTL on the Redis response list."""
    response_list_key = f"agent_run:{agent_run_id}:responses"
    try:
        await redis.expire(response_list_key, REDIS_RESPONSE_LIST_TTL)
        logger.debug(f"Set TTL ({REDIS_RESPONSE_LIST_TTL}s) on response list: {response_list_key}")
    except Exception as e:
        logger.warning(f"Failed to set TTL on response list {response_list_key}: {str(e)}")

async def _robust_cleanup_redis_response_list(agent_run_id: str):
    """Robust cleanup with retry logic for Redis response list."""
    for attempt in range(3):
        try:
            await _cleanup_redis_response_list(agent_run_id)
            return
        except Exception as e:
            if attempt == 2:
                logger.error(f"Failed to cleanup response list after 3 attempts: {e}")
                raise
            await asyncio.sleep(1.0)

async def _update_task_status(agent_run_id: str, status: str, data: Optional[dict] = None):
    """Write task status to Redis for retrieval via API."""
    key = f"task_status:{agent_run_id}"
    payload = {
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if data:
        payload["data"] = data
    try:
        await redis.set(key, json.dumps(payload), ex=REDIS_RESPONSE_LIST_TTL)
    except Exception as e:
        logger.warning(f"Failed to set task status in Redis for {agent_run_id}: {e}")

async def get_task_status(agent_run_id: str):
    """Read task status from Redis if available; return None if not found."""
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
    error: Optional[str] = None,
    responses: Optional[list[any]] = None # Expects parsed list of dicts
) -> bool:
    """
    Centralized function to update agent run status.
    Returns True if update was successful.
    """
    try:
        update_data = {
            "status": status,
            "completed_at": datetime.now(timezone.utc).isoformat()
        }

        if error:
            update_data["error"] = error

        if responses:
            # Ensure responses are stored correctly as JSONB
            update_data["responses"] = responses

        # Retry up to 3 times
        for retry in range(3):
            try:
                update_result = await client.table('agent_runs').update(update_data).eq("run_id", agent_run_id).execute()

                if hasattr(update_result, 'data') and update_result.data:
                    logger.info(f"Successfully updated agent run {agent_run_id} status to '{status}' (retry {retry})")

                    # Verify the update
                    verify_result = await client.table('agent_runs').select('status', 'completed_at').eq("run_id", agent_run_id).execute()
                    if verify_result.data:
                        actual_status = verify_result.data[0].get('status')
                        completed_at = verify_result.data[0].get('completed_at')
                        logger.info(f"Verified agent run update: status={actual_status}, completed_at={completed_at}")
                    return True
                else:
                    logger.warning(f"Database update returned no data for agent run {agent_run_id} on retry {retry}: {update_result}")
                    if retry == 2:  # Last retry
                        logger.error(f"Failed to update agent run status after all retries: {agent_run_id}")
                        return False
            except Exception as db_error:
                logger.error(f"Database error on retry {retry} updating status for {agent_run_id}: {str(db_error)}")
                if retry < 2:  # Not the last retry yet
                    await asyncio.sleep(0.5 * (2 ** retry))  # Exponential backoff
                else:
                    logger.error(f"Failed to update agent run status after all retries: {agent_run_id}", exc_info=True)
                    return False
    except Exception as e:
        logger.error(f"Unexpected error updating agent run status for {agent_run_id}: {str(e)}", exc_info=True)
        return False

    return False

# Utility function for stopping agent runs
async def stop_agent_run(agent_run_id: str, instance_id: Optional[str] = None):
    """
    Send a STOP signal to a running agent.
    
    Args:
        agent_run_id: The ID of the agent run to stop
        instance_id: Optional specific instance ID to target
    """
    try:
        if instance_id:
            # Send to specific instance
            control_channel = f"agent_run:{agent_run_id}:control:{instance_id}"
            await redis.publish(control_channel, "STOP")
            logger.info(f"Sent STOP signal to instance {instance_id} for agent run {agent_run_id}")
        else:
            # Send to all instances listening for this agent run
            global_control_channel = f"agent_run:{agent_run_id}:control"
            await redis.publish(global_control_channel, "STOP")
            logger.info(f"Sent STOP signal to all instances for agent run {agent_run_id}")
        
        return True
    except Exception as e:
        logger.error(f"Failed to send STOP signal for agent run {agent_run_id}: {e}")
        return False

if __name__ == "__main__":
    import dramatiq
    from dramatiq.cli import main
    main()