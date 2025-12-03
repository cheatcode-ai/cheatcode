from fastapi import APIRouter, HTTPException, Depends, Request, Body, File, UploadFile, Form, Query
from fastapi.responses import StreamingResponse
import asyncio
import json
import traceback
from datetime import datetime, timezone
import uuid
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
import os
import mimetypes


from services.supabase import DBConnection
from utils.auth_utils import get_current_user_id_from_jwt, verify_thread_access, get_user_id_from_stream_auth
from utils.logger import logger, structlog
from services.billing import check_billing_status, can_use_model
from utils.config import config
from utils.encryption import decrypt_data
from sandbox.sandbox import create_sandbox_from_snapshot, delete_sandbox, get_or_start_sandbox
from services.llm import make_llm_api_call
from agent.run_agent import run_agent_run_stream, update_agent_run_status
from utils.constants import MODEL_NAME_ALIASES
# from flags.flags import is_enabled  # Unused import
import run_agent_background
from services import redis

from .utils import check_for_active_project_agent_run

# Initialize shared resources
router = APIRouter()
db = None
instance_id = None # Global instance ID for this backend instance

# TTL for Redis response lists (24 hours)
REDIS_RESPONSE_LIST_TTL = 3600 * 24

# Response batching configuration for SSE streaming
# Batching reduces network overhead by combining multiple small messages
SSE_BATCH_SIZE = 10  # Max responses per batch
SSE_BATCH_TIMEOUT_MS = 50  # Max time to wait for batch (ms)


def format_sse_batch(responses: list) -> str:
    """
    Format multiple responses into a single SSE batch message.

    Uses a custom 'batch' event type that clients can parse to extract
    individual responses. Falls back to single response format for
    backward compatibility when batch size is 1.

    Args:
        responses: List of response dictionaries to batch

    Returns:
        SSE-formatted string with batched responses
    """
    if not responses:
        return ""

    if len(responses) == 1:
        # Single response - use standard format for backward compatibility
        return f"data: {json.dumps(responses[0])}\n\n"

    # Multiple responses - batch them together
    # Client should handle 'batch' wrapper and extract 'items' array
    batch_payload = {
        "type": "batch",
        "count": len(responses),
        "items": responses
    }
    return f"data: {json.dumps(batch_payload)}\n\n"


def chunk_responses(responses: list, chunk_size: int = SSE_BATCH_SIZE) -> list:
    """
    Split responses into chunks for batched streaming.

    Args:
        responses: List of responses to chunk
        chunk_size: Maximum items per chunk

    Returns:
        List of response chunks
    """
    if not responses:
        return []
    return [responses[i:i + chunk_size] for i in range(0, len(responses), chunk_size)]


def is_image_file(file: UploadFile) -> bool:
    """Check if the uploaded file is an image based on MIME type and filename"""
    # Check MIME type first (most reliable)
    if file.content_type and file.content_type.startswith('image/'):
        return True
    
    # Check file extension as fallback
    if file.filename:
        filename_lower = file.filename.lower()
        image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif']
        if any(filename_lower.endswith(ext) for ext in image_extensions):
            return True
            
        # Also check using mimetypes module
        mime_type, _ = mimetypes.guess_type(file.filename)
        if mime_type and mime_type.startswith('image/'):
            return True
    
    return False

async def get_account_id_from_clerk_user(client, user_id: str) -> str:
    """Get the account ID for a Clerk user"""
    account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': user_id}).execute()
    if not account_result.data:
        raise HTTPException(status_code=400, detail="User account not found")
    return account_result.data

class AgentStartRequest(BaseModel):
    model_name: Optional[str] = None  # Will be set from config.MODEL_TO_USE in the endpoint
    enable_thinking: Optional[bool] = False
    reasoning_effort: Optional[str] = 'low'
    stream: Optional[bool] = True
    enable_context_manager: Optional[bool] = True
    app_type: Optional[str] = 'web'

class InitiateAgentResponse(BaseModel):
    thread_id: str
    agent_run_id: Optional[str] = None

# Removed unused agent-related models:
# - AgentCreateRequest, AgentUpdateRequest - deleted custom agent endpoints
# - AgentResponse, PaginationInfo, AgentsResponse - agents table dropped
# - ThreadAgentResponse - hardcoded agent display

def initialize(
    _db: DBConnection,
    _instance_id: Optional[str] = None
):
    """Initialize the agent API with resources from the main API."""
    global db, instance_id
    db = _db

    # Use provided instance_id or generate a new one
    if _instance_id:
        instance_id = _instance_id
    else:
        # Generate instance ID
        instance_id = str(uuid.uuid4())[:8]

    logger.info(f"Initialized agent API with instance ID: {instance_id}")

async def cleanup():
    """Clean up resources and stop running agents on shutdown."""
    logger.info("Starting cleanup of agent API resources")

    # Use the instance_id to find and clean up this instance's keys
    try:
        if instance_id: # Ensure instance_id is set
            running_keys = await redis.scan_keys(f"active_run:{instance_id}:*")
            logger.info(f"Found {len(running_keys)} running agent runs for instance {instance_id} to clean up")

            for key in running_keys:
                # Key format: active_run:{instance_id}:{agent_run_id}
                parts = key.split(":")
                if len(parts) == 3:
                    agent_run_id = parts[2]
                    # Use background worker's stop function to publish to correct control channel
                    await run_agent_background.stop_agent_run(agent_run_id)
                else:
                    logger.warning(f"Unexpected key format found: {key}")
        else:
            logger.warning("Instance ID not set, cannot clean up instance-specific agent runs.")

    except Exception as e:
        logger.error(f"Failed to clean up running agent runs: {str(e)}")

    # Close Redis connection
    await redis.close()
    logger.info("Completed cleanup of agent API resources")




async def get_agent_run_with_access_check(client, agent_run_id: str, user_id: str):
    agent_run = await client.table('agent_runs').select('*').eq('run_id', agent_run_id).execute()
    if not agent_run.data:
        raise HTTPException(status_code=404, detail="Agent run not found")

    agent_run_data = agent_run.data[0]
    thread_id = agent_run_data['thread_id']
    await verify_thread_access(client, thread_id, user_id)
    return agent_run_data




@router.post("/thread/{thread_id}/agent/start")
async def start_agent(
    thread_id: str,
    body: AgentStartRequest = Body(...),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Start an agent for a specific thread in the background."""
    structlog.contextvars.bind_contextvars(
        thread_id=thread_id,
    )
    global instance_id # Ensure instance_id is accessible
    if not instance_id:
        raise HTTPException(status_code=500, detail="Agent API not initialized with instance ID")

    # Use model from config if not specified in the request
    model_name = body.model_name
    logger.info(f"Original model_name from request: {model_name}")

    if model_name is None:
        model_name = config.MODEL_TO_USE
        logger.info(f"Using model from config: {model_name}")

    # Log the model name after alias resolution
    resolved_model = MODEL_NAME_ALIASES.get(model_name, model_name)
    logger.info(f"Resolved model name: {resolved_model}")

    # Update model_name to use the resolved version
    model_name = resolved_model

    # Validate app_type parameter for type safety
    if body.app_type not in ['web', 'mobile']:
        logger.warning(f"Invalid app_type '{body.app_type}' received, defaulting to 'web'")
        body.app_type = 'web'
    
    logger.info(f"Starting new agent for thread: {thread_id} with config: model={model_name}, thinking={body.enable_thinking}, effort={body.reasoning_effort}, stream={body.stream}, context_manager={body.enable_context_manager}, app_type={body.app_type} (Instance: {instance_id})")
    client = await db.client

    await verify_thread_access(client, thread_id, user_id)

    # Batch initial queries for better performance
    thread_result = await client.table('threads').select('project_id', 'user_id', 'metadata').eq('thread_id', thread_id).execute()
    if not thread_result.data:
        raise HTTPException(status_code=404, detail="Thread not found")
    thread_data = thread_result.data[0]
    project_id = thread_data.get('project_id')
    account_id = thread_data.get('user_id')
    
    # Batch queries: token status, MCP credentials, and project data in parallel
    try:
        from services.token_billing import get_user_token_status
        from utils.constants import TOKENS_PER_CONVERSATION_ESTIMATE, get_credits_from_tokens

        # Run queries in parallel for better performance
        token_status_task = asyncio.create_task(get_user_token_status(client, account_id))
        cred_profiles_task = asyncio.create_task(
            client.table('user_mcp_credential_profiles').select(
                'profile_id, mcp_qualified_name, display_name, encrypted_config, is_default_for_dashboard'
            ).eq('user_id', account_id).eq('is_active', True).eq('is_default_for_dashboard', True).execute()
        ) if project_id else None
        project_task = asyncio.create_task(
            client.table('projects').select('*').eq('project_id', project_id).execute()
        ) if project_id else None

        # Await token status first (needed for quota check)
        token_status = await token_status_task
        
        # Check if user has enough tokens for a conversation
        if token_status['plan'] != 'byok' and token_status['tokens_remaining'] < TOKENS_PER_CONVERSATION_ESTIMATE:
            remaining_credits = token_status['credits_remaining']
            needed_credits = get_credits_from_tokens(TOKENS_PER_CONVERSATION_ESTIMATE)
            
            raise HTTPException(
                status_code=402,  # Payment Required
                detail={
                    "error": "insufficient_credits",
                    "message": f"Insufficient credits to start conversation. You have {remaining_credits} credits remaining, but need at least {needed_credits} credits.",
                    "credits_remaining": remaining_credits,
                    "credits_needed": needed_credits,
                    "current_plan": token_status['plan_name'],
                    "upgrade_required": True
                }
            )
            
        logger.info(f"✅ Token quota check passed for account {account_id}. Remaining: {token_status['tokens_remaining']} tokens ({token_status['credits_remaining']} credits)")
        
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        logger.error(f"Error checking token quota for account {account_id}: {str(e)}")
        # Don't block execution for quota check errors in case of system issues
    
    thread_metadata = thread_data.get('metadata', {})

    structlog.contextvars.bind_contextvars(
        project_id=project_id,
        account_id=account_id,
        thread_metadata=thread_metadata,
    )

    # This is now a coding-only system - always use coding agent configuration
    agent_config = {
        'name': 'Coding Agent',
        'description': 'Specialized agent for webapp development with 100+ UI components',
        'system_prompt': '',  # Will use get_coding_agent_prompt() from run.py
        'configured_mcps': [],
        'custom_mcps': [],
        # No agentpress_tools specified so all tools are enabled by default
        'account_id': account_id
    }
    logger.info(f"Using coding agent configuration with all development tools enabled")

    # Load and merge dashboard MCP preferences for dashboard chats
    logger.info(f"Loading dashboard MCP preferences for account {account_id}")
    try:
        # Use pre-fetched credential profiles from parallel query above
        cred_profiles_result = await cred_profiles_task if cred_profiles_task else await client.table('user_mcp_credential_profiles').select(
            'profile_id, mcp_qualified_name, display_name, encrypted_config, is_default_for_dashboard'
        ).eq('user_id', account_id).eq('is_active', True).eq('is_default_for_dashboard', True).execute()

        logger.info(f"[MCP DEBUG] Credential profiles query result: {len(cred_profiles_result.data) if cred_profiles_result.data else 0} profiles found for account {account_id}")

        if cred_profiles_result.data:
            dashboard_configured_mcps = []

            for profile in cred_profiles_result.data:
                logger.info(f"[MCP DEBUG] Processing profile: {profile['profile_id']}, qualified_name: {profile['mcp_qualified_name']}, display_name: {profile['display_name']}")

                # Decrypt and parse the configuration
                try:
                    decrypted_config = await asyncio.to_thread(
                        decrypt_data, profile['encrypted_config']
                    )
                    config_data = json.loads(decrypted_config)
                    logger.info(f"[MCP DEBUG] Decrypted config keys for {profile['profile_id']}: {list(config_data.keys())}")
                    logger.info(f"[MCP DEBUG] connected_account_id present: {'connected_account_id' in config_data}")
                except Exception as e:
                    logger.error(f"Failed to decrypt config for profile {profile['profile_id']}: {e}")
                    config_data = {}

                # Remove provider prefix (e.g., "composio:") for the server key used in tool names
                clean_server_name = profile['mcp_qualified_name']
                if ':' in clean_server_name:
                    clean_server_name = clean_server_name.split(':', 1)[1]

                # Add each credential profile as a configured MCP
                mcp_config = {
                    'name': clean_server_name,
                    'qualifiedName': clean_server_name,
                    'provider': 'composio',
                    'config': config_data,
                    'enabledTools': [],  # Enable all tools by default
                    'instructions': f"Use {profile['display_name']} integration",
                    'isCustom': False
                }
                logger.info(f"[MCP DEBUG] Created MCP config for {clean_server_name}: name={mcp_config['name']}, isCustom={mcp_config['isCustom']}")
                dashboard_configured_mcps.append(mcp_config)

            # Merge dashboard MCPs with existing agent configuration
            logger.info(f"[MCP DEBUG] Merging {len(dashboard_configured_mcps)} dashboard MCPs with existing agent config")
            existing_mcps = agent_config.get('configured_mcps', [])
            # Add dashboard MCPs that aren't already configured
            existing_qualified_names = {mcp.get('qualifiedName') for mcp in existing_mcps}
            for dashboard_mcp in dashboard_configured_mcps:
                if dashboard_mcp['qualifiedName'] not in existing_qualified_names:
                    existing_mcps.append(dashboard_mcp)
            agent_config['configured_mcps'] = existing_mcps
            logger.info(f"[MCP DEBUG] Final agent_config['configured_mcps'] has {len(existing_mcps)} MCPs: {[mcp.get('qualifiedName') for mcp in existing_mcps]}")
        else:
            logger.info(f"No dashboard MCP credentials found for account {account_id}")

    except Exception as e:
        logger.error(f"Error loading dashboard MCP preferences for account {account_id}: {str(e)}")
        # Continue without MCPs if loading fails

    can_use, model_message, allowed_models = await can_use_model(client, account_id, model_name)
    if not can_use:
        raise HTTPException(status_code=403, detail={"message": model_message, "allowed_models": allowed_models})

    can_run, message, subscription = await check_billing_status(client, account_id)
    if not can_run:
        raise HTTPException(status_code=402, detail={"message": message, "subscription": subscription})

    active_run_id = await check_for_active_project_agent_run(client, project_id)
    if active_run_id:
        logger.info(f"Stopping existing agent run {active_run_id} for project {project_id}")
        await run_agent_background.stop_agent_run(active_run_id)

    try:
        # Use pre-fetched project data from parallel query above
        project_result = await project_task if project_task else await client.table('projects').select('*').eq('project_id', project_id).execute()
        if not project_result.data:
            raise HTTPException(status_code=404, detail="Project not found")
        
        project_data = project_result.data[0]
        sandbox_info = project_data.get('sandbox', {})
        if not sandbox_info.get('id'):
            raise HTTPException(status_code=404, detail="No sandbox found for this project")
            
        sandbox_id = sandbox_info['id']
        sandbox = await get_or_start_sandbox(sandbox_id)
        logger.info(f"Successfully started sandbox {sandbox_id} for project {project_id}")
    except Exception as e:
        logger.error(f"Failed to start sandbox for project {project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to initialize sandbox: {str(e)}")

    agent_run = await client.table('agent_runs').insert({
        "thread_id": thread_id, "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "model_name": model_name,
            "enable_thinking": body.enable_thinking,
            "reasoning_effort": body.reasoning_effort,
            "enable_context_manager": body.enable_context_manager
        }
    }).execute()
    agent_run_id = agent_run.data[0]['run_id']
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
    )
    logger.info(f"Created new agent run: {agent_run_id}")

    # Register this run in Redis with TTL using instance ID
    instance_key = f"active_run:{instance_id}:{agent_run_id}"
    try:
        await redis.set(instance_key, "running", ex=redis.REDIS_KEY_TTL)
    except Exception as e:
        logger.warning(f"Failed to register agent run in Redis ({instance_key}): {str(e)}")

    # Queue background task instead of running agent directly
    request_id = str(uuid.uuid4())
    logger.info(f"Queuing background task for agent run {agent_run_id}")
    
    try:
        run_agent_background.run_agent_background.send(
            agent_run_id=agent_run_id,
            thread_id=thread_id,
            instance_id=instance_id,
            project_id=project_id,
            model_name=model_name,
            enable_thinking=body.enable_thinking,
            reasoning_effort=body.reasoning_effort,
            stream=body.stream,
            enable_context_manager=body.enable_context_manager,
            agent_config=agent_config,
            request_id=request_id,
            app_type=body.app_type
        )
        logger.info(f"Successfully queued background task for agent run {agent_run_id}")
    except Exception as e:
        logger.error(f"Failed to queue background task for agent run {agent_run_id}: {e}")
        # Update agent run status to failed
        await client.table('agent_runs').update({
            "status": "failed",
            "error": f"Failed to queue background task: {str(e)}",
            "completed_at": datetime.now(timezone.utc).isoformat()
        }).eq('run_id', agent_run_id).execute()
        raise HTTPException(status_code=500, detail=f"Failed to queue background task: {str(e)}")

    return {"agent_run_id": agent_run_id, "status": "queued"}

@router.get("/agent-run/{agent_run_id}/stream")
async def stream_agent_run(
    agent_run_id: str,
    token: Optional[str] = None,
    request: Request = None
):
    """Stream the responses of an agent run using Server-Sent Events (SSE)."""
    logger.info(f"Starting SSE stream for agent run: {agent_run_id}")
    client = await db.client

    user_id = await get_user_id_from_stream_auth(request, token)
    agent_run_data = await get_agent_run_with_access_check(client, agent_run_id, user_id)

    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
        user_id=user_id,
    )

    response_list_key = f"agent_run:{agent_run_id}:responses"
    response_channel = f"agent_run:{agent_run_id}:new_response"
    control_channel = f"agent_run:{agent_run_id}:control"

    async def stream_generator():
        logger.debug(f"Streaming responses for {agent_run_id} using Redis list {response_list_key} and channel {response_channel}")
        last_processed_index = -1
        pubsub_response = None
        pubsub_control = None
        listener_task = None
        terminate_stream = False
        initial_yield_complete = False

        try:
            # 1. Fetch and yield initial responses from Redis list (with batching)
            initial_responses_json = await redis.lrange(response_list_key, 0, -1)
            initial_responses = []
            if initial_responses_json:
                initial_responses = [json.loads(r) for r in initial_responses_json]
                logger.debug(f"Sending {len(initial_responses)} initial responses for {agent_run_id} (batched)")

                # Batch initial responses for efficiency
                batches = chunk_responses(initial_responses, SSE_BATCH_SIZE)
                for batch in batches:
                    yield format_sse_batch(batch)

                last_processed_index = len(initial_responses) - 1
            initial_yield_complete = True

            # 2. Check run status *after* yielding initial data
            run_status = await client.table('agent_runs').select('status', 'thread_id').eq("run_id", agent_run_id).maybe_single().execute()
            current_status = run_status.data.get('status') if run_status.data else None

            if current_status != 'running':
                logger.info(f"Agent run {agent_run_id} is not running (status: {current_status}). Ending stream.")
                yield f"data: {json.dumps({'type': 'status', 'status': 'completed'})}\n\n"
                return
          
            structlog.contextvars.bind_contextvars(
                thread_id=run_status.data.get('thread_id'),
            )

            # 3. Set up Pub/Sub listeners for new responses and control signals
            try:
                pubsub_response = await redis.create_pubsub()
                await pubsub_response.subscribe(response_channel)
                logger.debug(f"Subscribed to response channel: {response_channel}")
            except Exception as e:
                logger.error(f"Failed to create/subscribe to response pubsub for {agent_run_id}: {e}", exc_info=True)
                raise HTTPException(
                    status_code=503, 
                    detail=f"Failed to set up response streaming: {str(e)}"
                )

            try:
                pubsub_control = await redis.create_pubsub()
                await pubsub_control.subscribe(control_channel)
                logger.debug(f"Subscribed to control channel: {control_channel}")
            except Exception as e:
                logger.error(f"Failed to create/subscribe to control pubsub for {agent_run_id}: {e}", exc_info=True)
                # Cleanup response pubsub if control setup fails
                try:
                    if pubsub_response:
                        await pubsub_response.unsubscribe(response_channel)
                        await pubsub_response.close()
                except Exception as cleanup_e:
                    logger.error(f"Failed to cleanup response pubsub after control setup failure: {cleanup_e}")
                raise HTTPException(
                    status_code=503, 
                    detail=f"Failed to set up control streaming: {str(e)}"
                )

            # Queue to communicate between listeners and the main generator loop
            message_queue = asyncio.Queue()

            async def listen_messages():
                response_reader = None
                control_reader = None
                tasks = []
                
                try:
                    response_reader = pubsub_response.listen()
                    control_reader = pubsub_control.listen()
                    tasks = [asyncio.create_task(response_reader.__anext__()), asyncio.create_task(control_reader.__anext__())]
                except Exception as setup_error:
                    logger.error(f"Failed to set up listeners for {agent_run_id}: {setup_error}", exc_info=True)
                    await message_queue.put({
                        "type": "error", 
                        "data": f"Listener setup failed: {str(setup_error)}",
                        "error_type": "setup_failure",
                        "recoverable": False
                    })
                    return

                listener_failure_count = 0
                max_listener_failures = 3
                
                while not terminate_stream and listener_failure_count < max_listener_failures:
                    try:
                        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED, timeout=30.0)
                        
                        # Handle timeout case
                        if not done:
                            logger.warning(f"Listener timeout after 30s for {agent_run_id}, sending heartbeat")
                            await message_queue.put({"type": "heartbeat"})
                            continue
                            
                        for task in done:
                            try:
                                message = task.result()
                                if message and isinstance(message, dict) and message.get("type") == "message":
                                    channel = message.get("channel")
                                    data = message.get("data")
                                    if isinstance(data, bytes): data = data.decode('utf-8')

                                    if channel == response_channel and data == "new":
                                        await message_queue.put({"type": "new_response"})
                                    elif channel == control_channel and data in ["STOP", "END_STREAM", "ERROR"]:
                                        logger.info(f"Received control signal '{data}' for {agent_run_id}")
                                        await message_queue.put({"type": "control", "data": data})
                                        return # Stop listening on control signal

                            except StopAsyncIteration:
                                logger.warning(f"Listener {task} stopped for {agent_run_id}")
                                listener_failure_count += 1
                                await message_queue.put({
                                    "type": "error", 
                                    "data": f"Redis connection lost (attempt {listener_failure_count}/{max_listener_failures})",
                                    "error_type": "connection_lost",
                                    "recoverable": listener_failure_count < max_listener_failures
                                })
                                if listener_failure_count >= max_listener_failures:
                                    return
                            except Exception as task_error:
                                listener_failure_count += 1
                                error_msg = f"Listener task failed: {str(task_error)} (attempt {listener_failure_count}/{max_listener_failures})"
                                logger.error(f"Error in listener task for {agent_run_id}: {task_error}", exc_info=True)
                                await message_queue.put({
                                    "type": "error", 
                                    "data": error_msg,
                                    "error_type": "task_failure",
                                    "recoverable": listener_failure_count < max_listener_failures
                                })
                                if listener_failure_count >= max_listener_failures:
                                    return
                            finally:
                                # Reschedule the completed listener task
                                if task in tasks:
                                    tasks.remove(task)
                                    try:
                                        if message and isinstance(message, dict):
                                            if message.get("channel") == response_channel:
                                                tasks.append(asyncio.create_task(response_reader.__anext__()))
                                            elif message.get("channel") == control_channel:
                                                tasks.append(asyncio.create_task(control_reader.__anext__()))
                                    except Exception as reschedule_error:
                                        logger.error(f"Failed to reschedule listener task for {agent_run_id}: {reschedule_error}")
                                        listener_failure_count += 1
                                        if listener_failure_count >= max_listener_failures:
                                            await message_queue.put({
                                                "type": "error",
                                                "data": f"Failed to reschedule listener: {str(reschedule_error)}",
                                                "error_type": "reschedule_failure", 
                                                "recoverable": False
                                            })
                                            return
                                        
                    except asyncio.CancelledError:
                        logger.info(f"Listener cancelled for {agent_run_id}")
                        break
                    except Exception as listener_error:
                        listener_failure_count += 1
                        error_msg = f"Listener loop failed: {str(listener_error)} (attempt {listener_failure_count}/{max_listener_failures})"
                        logger.error(f"Error in listener loop for {agent_run_id}: {listener_error}", exc_info=True)
                        await message_queue.put({
                            "type": "error",
                            "data": error_msg,
                            "error_type": "loop_failure",
                            "recoverable": listener_failure_count < max_listener_failures
                        })
                        if listener_failure_count >= max_listener_failures:
                            break
                        # Brief delay before retry
                        await asyncio.sleep(1.0)
                
                # Cleanup on exit
                try:
                    # Cancel pending listener tasks on exit
                    for p_task in pending: 
                        if not p_task.done():
                            p_task.cancel()
                    for task in tasks: 
                        if not task.done():
                            task.cancel()
                except Exception as cleanup_error:
                    logger.error(f"Error during listener task cleanup for {agent_run_id}: {cleanup_error}")
                    
                logger.debug(f"Listener task completed for {agent_run_id}")

            listener_task = asyncio.create_task(listen_messages())

            # 4. Main loop to process messages from the queue
            while not terminate_stream:
                try:
                    queue_item = await message_queue.get()

                    if queue_item["type"] == "new_response":
                        # Fetch new responses from Redis list starting after the last processed index
                        new_start_index = last_processed_index + 1
                        new_responses_json = await redis.lrange(response_list_key, new_start_index, -1)

                        if new_responses_json:
                            new_responses = [json.loads(r) for r in new_responses_json]
                            num_new = len(new_responses)

                            # Check for completion signals in responses
                            completion_index = -1
                            for idx, response in enumerate(new_responses):
                                if response.get('type') == 'status' and response.get('status') in ['completed', 'failed', 'stopped']:
                                    logger.info(f"Detected run completion via status message in stream: {response.get('status')}")
                                    completion_index = idx
                                    terminate_stream = True
                                    break

                            # If completion found, only batch up to and including it
                            responses_to_send = new_responses[:completion_index + 1] if completion_index >= 0 else new_responses

                            # Batch and yield responses for efficiency
                            batches = chunk_responses(responses_to_send, SSE_BATCH_SIZE)
                            for batch in batches:
                                yield format_sse_batch(batch)

                            last_processed_index += len(responses_to_send)
                        if terminate_stream: break

                    elif queue_item["type"] == "control":
                        control_signal = queue_item["data"]
                        terminate_stream = True # Stop the stream on any control signal
                        yield f"data: {json.dumps({'type': 'status', 'status': control_signal})}\n\n"
                        break

                    elif queue_item["type"] == "error":
                        error_data = queue_item.get("data", "Unknown error")
                        error_type = queue_item.get("error_type", "general")
                        is_recoverable = queue_item.get("recoverable", False)
                        
                        logger.error(f"Listener error for {agent_run_id}: {error_data} (type: {error_type}, recoverable: {is_recoverable})")
                        
                        # For non-recoverable errors, terminate the stream
                        if not is_recoverable:
                            terminate_stream = True
                            payload = {
                                'type': 'status',
                                'status': 'error',
                                'message': error_data,
                                'error_type': error_type
                            }
                            yield f"data: {json.dumps(payload)}\n\n"
                            break
                        else:
                            # For recoverable errors, send a warning but continue
                            warning_message = f"Stream issue (recovering): {error_data}"
                            payload = {
                                'type': 'warning',
                                'message': warning_message,
                                'error_type': error_type
                            }
                            yield f"data: {json.dumps(payload)}\n\n"
                    
                    elif queue_item["type"] == "heartbeat":
                        # Send heartbeat to keep connection alive
                        yield f"data: {json.dumps({'type': 'ping'})}\n\n"

                except asyncio.CancelledError:
                     logger.info(f"Stream generator main loop cancelled for {agent_run_id}")
                     terminate_stream = True
                     break
                except Exception as loop_err:
                    logger.error(f"Error in stream generator main loop for {agent_run_id}: {loop_err}", exc_info=True)
                    terminate_stream = True
                    yield f"data: {json.dumps({'type': 'status', 'status': 'error', 'message': f'Stream failed: {loop_err}'})}\n\n"
                    break

        except Exception as e:
            logger.error(f"Error setting up stream for agent run {agent_run_id}: {e}", exc_info=True)
            # Only yield error if initial yield didn't happen
            if not initial_yield_complete:
                 yield f"data: {json.dumps({'type': 'status', 'status': 'error', 'message': f'Failed to start stream: {e}'})}\n\n"
        finally:
            terminate_stream = True
            logger.debug(f"Starting cleanup for agent run: {agent_run_id}")
            
            # Graceful shutdown order: unsubscribe → close → cancel
            # Step 1: Unsubscribe from channels (prevents new messages)
            cleanup_errors = []
            
            try:
                if pubsub_response:
                    await pubsub_response.unsubscribe(response_channel)
                    logger.debug(f"Unsubscribed from response channel for {agent_run_id}")
            except Exception as e:
                cleanup_errors.append(f"Failed to unsubscribe from response channel: {e}")
                logger.warning(f"Error unsubscribing from response channel for {agent_run_id}: {e}")
            
            try:
                if pubsub_control:
                    await pubsub_control.unsubscribe(control_channel)
                    logger.debug(f"Unsubscribed from control channel for {agent_run_id}")
            except Exception as e:
                cleanup_errors.append(f"Failed to unsubscribe from control channel: {e}")
                logger.warning(f"Error unsubscribing from control channel for {agent_run_id}: {e}")
            
            # Step 2: Close pub/sub connections
            try:
                if pubsub_response:
                    await pubsub_response.close()
                    logger.debug(f"Closed response pubsub connection for {agent_run_id}")
            except Exception as e:
                cleanup_errors.append(f"Failed to close response pubsub: {e}")
                logger.warning(f"Error closing response pubsub for {agent_run_id}: {e}")
            
            try:
                if pubsub_control:
                    await pubsub_control.close()
                    logger.debug(f"Closed control pubsub connection for {agent_run_id}")
            except Exception as e:
                cleanup_errors.append(f"Failed to close control pubsub: {e}")
                logger.warning(f"Error closing control pubsub for {agent_run_id}: {e}")

            # Step 3: Cancel and await listener task
            if listener_task:
                try:
                    listener_task.cancel()
                    logger.debug(f"Cancelled listener task for {agent_run_id}")
                    
                    # Wait for cancellation with timeout
                    try:
                        await asyncio.wait_for(listener_task, timeout=5.0)
                    except asyncio.TimeoutError:
                        logger.warning(f"Listener task cancellation timed out for {agent_run_id}")
                        cleanup_errors.append("Listener task cancellation timeout")
                    except asyncio.CancelledError:
                        logger.debug(f"Listener task cancelled successfully for {agent_run_id}")
                        pass
                    except Exception as e:
                        logger.debug(f"Listener task ended with exception for {agent_run_id}: {e}")
                        # Not necessarily an error - task may have completed normally
                        
                except Exception as e:
                    cleanup_errors.append(f"Failed to cancel listener task: {e}")
                    logger.error(f"Error cancelling listener task for {agent_run_id}: {e}")
            
            # Brief wait for any remaining async operations to complete
            try:
                await asyncio.sleep(0.1)
            except Exception as e:
                logger.debug(f"Error during final sleep for {agent_run_id}: {e}")
            
            # Log cleanup completion
            if cleanup_errors:
                logger.warning(f"SSE streaming cleanup completed with {len(cleanup_errors)} errors for {agent_run_id}: {'; '.join(cleanup_errors)}")
            else:
                logger.debug(f"SSE streaming cleanup completed successfully for agent run: {agent_run_id}")

    return StreamingResponse(stream_generator(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive",
        "X-Accel-Buffering": "no", "Content-Type": "text/event-stream",
        "Access-Control-Allow-Origin": "*"
    })

@router.post("/agent-run/{agent_run_id}/stop")
async def stop_agent(agent_run_id: str, user_id: str = Depends(get_current_user_id_from_jwt)):
    """Stop a running agent."""
    structlog.contextvars.bind_contextvars(agent_run_id=agent_run_id)
    logger.info(f"Stop request received for agent run {agent_run_id}")
    
    try:
        # Verify user has access to this agent run
        client = await db.client
        agent_run_data = await get_agent_run_with_access_check(client, agent_run_id, user_id)
        
        # Check if agent run is in a stoppable state
        current_status = agent_run_data.get('status')
        if current_status not in ['running', 'queued']:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot stop agent run with status: {current_status}"
            )
        
        # Send STOP signal via Redis pub/sub
        success = await run_agent_background.stop_agent_run(agent_run_id)
        
        if success:
            # Update database status to stopping
            await client.table('agent_runs').update({
                "status": "stopping",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }).eq('run_id', agent_run_id).execute()
            
            logger.info(f"Successfully sent STOP signal for agent run {agent_run_id}")
            return {"message": "Stop signal sent", "agent_run_id": agent_run_id, "status": "stopping"}
        else:
            raise HTTPException(status_code=500, detail="Failed to send stop signal")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error stopping agent run {agent_run_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stop agent run: {str(e)}")

@router.get("/thread/{thread_id}/agent-runs")
async def get_agent_runs(thread_id: str, user_id: str = Depends(get_current_user_id_from_jwt)):
    """Get all agent runs for a thread."""
    structlog.contextvars.bind_contextvars(
        thread_id=thread_id,
    )
    logger.info(f"Fetching agent runs for thread: {thread_id}")
    client = await db.client
    await verify_thread_access(client, thread_id, user_id)
    agent_runs = await client.table('agent_runs').select('run_id, thread_id, status, started_at, completed_at, error, created_at, updated_at').eq("thread_id", thread_id).order('created_at', desc=True).execute()
    logger.debug(f"Found {len(agent_runs.data)} agent runs for thread: {thread_id}")
    return {"agent_runs": agent_runs.data}

@router.get("/agent-run/{agent_run_id}")
async def get_agent_run(agent_run_id: str, user_id: str = Depends(get_current_user_id_from_jwt)):
    """Get agent run status and responses."""
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
    )
    logger.info(f"Fetching agent run details: {agent_run_id}")
    client = await db.client
    agent_run_data = await get_agent_run_with_access_check(client, agent_run_id, user_id)
    # Note: Responses are not included here by default, they are in the stream or DB
    return {
                    "id": agent_run_data['run_id'],
        "threadId": agent_run_data['thread_id'],
        "status": agent_run_data['status'],
        "startedAt": agent_run_data['started_at'],
        "completedAt": agent_run_data['completed_at'],
        "error": agent_run_data['error']
    }

@router.get("/agent-run/{agent_run_id}/status")
async def get_agent_run_status(agent_run_id: str, user_id: str = Depends(get_current_user_id_from_jwt)):
    """Get the status of a background agent run."""
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
    )
    logger.info(f"Fetching agent run status: {agent_run_id}")
    client = await db.client
    agent_run_data = await get_agent_run_with_access_check(client, agent_run_id, user_id)
    
    # Get task status from Redis
    task_status = await run_agent_background.get_task_status(agent_run_id)
    
    if task_status:
        return {
            "agent_run_id": agent_run_id,
            "status": task_status["status"],
            "timestamp": task_status["timestamp"],
            "data": task_status.get("data", {}),
            "db_status": agent_run_data.get("status")
        }
    else:
        # Fallback to database status if Redis status not found
        return {
            "agent_run_id": agent_run_id,
            "status": agent_run_data.get("status", "unknown"),
            "timestamp": agent_run_data.get("started_at"),
            "data": {},
            "db_status": agent_run_data.get("status")
    }

# Removed GET /thread/{thread_id}/agent endpoint - no longer needed for hardcoded agent display



async def generate_and_update_project_name(project_id: str, prompt: str):
    """Generates a project name using an LLM and updates the database."""
    logger.info(f"Starting background task to generate name for project: {project_id}")
    try:
        db_conn = DBConnection()
        client = await db_conn.client

        # Use the configured model instead of hardcoded OpenAI
        model_name = config.MODEL_TO_USE
        system_prompt = "You are a helpful assistant that generates extremely concise titles (2-4 words maximum) for chat threads based on the user's message. Respond with only the title, no other text or punctuation."
        user_message = f"Generate an extremely brief title (2-4 words only) for a chat thread that starts with this message: \"{prompt}\""
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}]

        logger.debug(f"Calling LLM ({model_name}) for project {project_id} naming.")
        response = await make_llm_api_call(messages=messages, model_name=model_name, max_tokens=50, temperature=0.7)

        logger.debug(f"🔍 Project naming LLM response: {response}")
        
        generated_name = None
        if response and response.get('choices') and response['choices'][0].get('message'):
            raw_name = response['choices'][0]['message'].get('content', '').strip()
            logger.debug(f"🔍 Raw name from LLM: '{raw_name}' (length: {len(raw_name)})")
            cleaned_name = raw_name.strip('\'" \n\t')
            logger.debug(f"🔍 Cleaned name: '{cleaned_name}' (length: {len(cleaned_name)})")
            if cleaned_name:
                generated_name = cleaned_name
                logger.info(f"LLM generated name for project {project_id}: '{generated_name}'")
            else:
                logger.warning(f"LLM returned an empty name for project {project_id}. Raw: '{raw_name}', Cleaned: '{cleaned_name}'")
        else:
            logger.warning(f"Failed to get valid response from LLM for project {project_id} naming. Response: {response}")

        if generated_name:
            update_result = await client.table('projects').update({"name": generated_name}).eq("project_id", project_id).execute()
            if hasattr(update_result, 'data') and update_result.data:
                logger.info(f"Successfully updated project {project_id} name to '{generated_name}'")
            else:
                logger.error(f"Failed to update project {project_id} name in database. Update result: {update_result}")
        else:
            logger.warning(f"No generated name, skipping database update for project {project_id}.")

    except Exception as e:
        logger.error(f"Error in background naming task for project {project_id}: {str(e)}\n{traceback.format_exc()}")
    finally:
        # No need to disconnect DBConnection singleton instance here
        logger.info(f"Finished background naming task for project: {project_id}")

@router.post("/agent/initiate", response_model=InitiateAgentResponse)
async def initiate_agent_with_files(
    prompt: str = Form(...),
    model_name: Optional[str] = Form(None),  # Default to None to use config.MODEL_TO_USE
    enable_thinking: Optional[bool] = Form(False),
    reasoning_effort: Optional[str] = Form("low"),
    stream: Optional[bool] = Form(True),
    enable_context_manager: Optional[bool] = Form(True),
    files: List[UploadFile] = File(default=[]),
    app_type: Optional[str] = Form('web'),
    user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Initiate a new agent session with optional file attachments."""
    global instance_id # Ensure instance_id is accessible
    if not instance_id:
        raise HTTPException(status_code=500, detail="Agent API not initialized with instance ID")

    # Validate app_type parameter for type safety
    if app_type not in ['web', 'mobile']:
        logger.warning(f"Invalid app_type '{app_type}' received, defaulting to 'web'")
        app_type = 'web'
    
    logger.info(f"Initiating agent with app_type: {app_type}")

    # Use model from config if not specified in the request
    logger.info(f"Original model_name from request: {model_name}")

    if model_name is None:
        model_name = config.MODEL_TO_USE
        logger.info(f"Using model from config: {model_name}")

    # Log the model name after alias resolution
    resolved_model = MODEL_NAME_ALIASES.get(model_name, model_name)
    logger.info(f"Resolved model name: {resolved_model}")

    # Update model_name to use the resolved version
    model_name = resolved_model

    logger.info(f"[\033[91mDEBUG\033[0m] Initiating new coding agent with prompt and {len(files)} files (Instance: {instance_id}), model: {model_name}, enable_thinking: {enable_thinking}")
    client = await db.client
    
    # Get the account ID for this Clerk user
    account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': user_id}).execute()
    if not account_result.data:
        raise HTTPException(status_code=400, detail="User account not found")
    account_id = account_result.data
    
    # Check token quota before starting new conversation
    try:
        from services.token_billing import get_user_token_status
        from utils.constants import TOKENS_PER_CONVERSATION_ESTIMATE, get_credits_from_tokens
        
        token_status = await get_user_token_status(client, account_id)
        
        # Check if user has enough tokens for a conversation
        if token_status['plan'] != 'byok' and token_status['tokens_remaining'] < TOKENS_PER_CONVERSATION_ESTIMATE:
            remaining_credits = token_status['credits_remaining']
            needed_credits = get_credits_from_tokens(TOKENS_PER_CONVERSATION_ESTIMATE)
            
            raise HTTPException(
                status_code=402,  # Payment Required
                detail={
                    "error": "insufficient_credits",
                    "message": f"Insufficient credits to start conversation. You have {remaining_credits} credits remaining, but need at least {needed_credits} credits.",
                    "credits_remaining": remaining_credits,
                    "credits_needed": needed_credits,
                    "current_plan": token_status['plan_name'],
                    "upgrade_required": True
                }
            )
            
        logger.info(f"✅ Token quota check passed for account {account_id}. Remaining: {token_status['tokens_remaining']} tokens ({token_status['credits_remaining']} credits)")
        
    except HTTPException:
        raise  # Re-raise HTTP exceptions  
    except Exception as e:
        logger.error(f"Error checking token quota for account {account_id}: {str(e)}")
        # Don't block execution for quota check errors in case of system issues
    
    # This is now a coding-only system - always use coding agent configuration
    agent_config = {
        'name': 'Coding Agent',
        'description': 'Specialized agent for webapp development with 100+ UI components',
        'system_prompt': '',  # Will use get_coding_agent_prompt() from run.py
        'configured_mcps': [],
        'custom_mcps': [],
        # No agentpress_tools specified so all tools are enabled by default
        'account_id': account_id
    }
    logger.info(f"Using coding agent configuration with all development tools enabled")

    # Load and merge dashboard MCP preferences
    logger.info(f"Loading dashboard MCP preferences for account {account_id}")
    try:
        # Get user's MCP credential profiles that are set as default for dashboard
        cred_profiles_result = await client.table('user_mcp_credential_profiles').select(
            'profile_id, mcp_qualified_name, display_name, encrypted_config, is_default_for_dashboard'
        ).eq('user_id', account_id).eq('is_active', True).eq('is_default_for_dashboard', True).execute()

        logger.info(f"[MCP DEBUG initiate] Credential profiles query result: {len(cred_profiles_result.data) if cred_profiles_result.data else 0} profiles found for account {account_id}")

        if cred_profiles_result.data:
            dashboard_configured_mcps = []

            for profile in cred_profiles_result.data:
                logger.info(f"[MCP DEBUG initiate] Processing profile: {profile['profile_id']}, qualified_name: {profile['mcp_qualified_name']}")

                # Decrypt and parse the configuration
                try:
                    decrypted_config = await asyncio.to_thread(
                        decrypt_data, profile['encrypted_config']
                    )
                    config_data = json.loads(decrypted_config)
                    logger.info(f"[MCP DEBUG initiate] Decrypted config keys: {list(config_data.keys())}")
                    logger.info(f"[MCP DEBUG initiate] connected_account_id present: {'connected_account_id' in config_data}")
                except Exception as e:
                    logger.error(f"Failed to decrypt config for profile {profile['profile_id']}: {e}")
                    config_data = {}

                # Remove provider prefix (e.g., "composio:") for the server key used in tool names
                clean_server_name = profile['mcp_qualified_name']
                if ':' in clean_server_name:
                    clean_server_name = clean_server_name.split(':', 1)[1]

                # Add each credential profile as a configured MCP
                mcp_config = {
                    'name': clean_server_name,
                    'qualifiedName': clean_server_name,
                    'provider': 'composio',
                    'config': config_data,
                    'enabledTools': [],  # Enable all tools by default
                    'instructions': f"Use {profile['display_name']} integration",
                    'isCustom': False
                }
                logger.info(f"[MCP DEBUG initiate] Created MCP config for {clean_server_name}")
                dashboard_configured_mcps.append(mcp_config)

            # Merge dashboard MCPs with coding agent configuration
            logger.info(f"[MCP DEBUG initiate] Merging {len(dashboard_configured_mcps)} dashboard MCPs with coding agent config")
            agent_config['configured_mcps'] = dashboard_configured_mcps
            logger.info(f"[MCP DEBUG initiate] Final agent_config['configured_mcps'] has {len(dashboard_configured_mcps)} MCPs: {[mcp.get('qualifiedName') for mcp in dashboard_configured_mcps]}")
        else:
            logger.info(f"No dashboard MCP credentials found for account {account_id}")
    except Exception as e:
        logger.error(f"Error loading dashboard MCP preferences for account {account_id}: {str(e)}")
        # Continue without MCPs if there's an error
    
    can_use, model_message, allowed_models = await can_use_model(client, account_id, model_name)
    if not can_use:
        raise HTTPException(status_code=403, detail={"message": model_message, "allowed_models": allowed_models})

    can_run, message, subscription = await check_billing_status(client, account_id)
    if not can_run:
        raise HTTPException(status_code=402, detail={"message": message, "subscription": subscription})

    try:
        # 1. Create Project
        placeholder_name = f"{prompt[:30]}..." if len(prompt) > 30 else prompt
        project = await client.table('projects').insert({
            "project_id": str(uuid.uuid4()), "user_id": account_id, "name": placeholder_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "app_type": app_type  # Store app_type in project for later retrieval
        }).execute()
        project_id = project.data[0]['project_id']
        logger.info(f"Created new project: {project_id}")

        # 2. Create Sandbox
        sandbox_id = None
        try:
          # Select appropriate snapshot based on app_type
          if app_type == 'mobile':
              snapshot_name = config.MOBILE_SANDBOX_SNAPSHOT_NAME
              logger.info(f"Using mobile snapshot for app_type: {app_type}")
          else:
              snapshot_name = config.SANDBOX_SNAPSHOT_NAME
              logger.info(f"Using web snapshot for app_type: {app_type}")
          
          sandbox = await create_sandbox_from_snapshot(
              project_id,
              snapshot=snapshot_name,
              account_id=account_id,
          )
          sandbox_id = sandbox.id
          logger.info(f"Created new sandbox {sandbox_id} for project {project_id} with snapshot {snapshot_name}")
          
          # Get preview links - use appropriate port based on app_type
          if app_type == 'mobile':
              dev_server_link = await sandbox.get_preview_link(8081)  # Expo Metro bundler
              logger.info(f"Using mobile dev server port 8081 for app_type: {app_type}")
          else:
              dev_server_link = await sandbox.get_preview_link(3000)  # Next.js dev server
              logger.info(f"Using web dev server port 3000 for app_type: {app_type}")
          
          api_server_link = await sandbox.get_preview_link(8000)  # FastAPI/Django server
          dev_server_url = dev_server_link.url if hasattr(dev_server_link, 'url') else str(dev_server_link).split("url='")[1].split("'")[0]
          api_server_url = api_server_link.url if hasattr(api_server_link, 'url') else str(api_server_link).split("url='")[1].split("'")[0]
          token = None
          if hasattr(dev_server_link, 'token'):
              token = dev_server_link.token
          elif "token='" in str(dev_server_link):
              token = str(dev_server_link).split("token='")[1].split("'")[0]
        except Exception as e:
            logger.error(f"Error creating sandbox: {str(e)}")
            await client.table('projects').delete().eq('project_id', project_id).execute()
            if sandbox_id:
              try: await delete_sandbox(sandbox_id)
              except Exception as e: pass
            raise Exception("Failed to create sandbox")


        # Update project with sandbox info
        update_result = await client.table('projects').update({
            'sandbox': {
                'id': sandbox_id, 'dev_server_url': dev_server_url,
                'api_server_url': api_server_url, 'token': token
            }
        }).eq('project_id', project_id).execute()

        if not update_result.data:
            logger.error(f"Failed to update project {project_id} with new sandbox {sandbox_id}")
            if sandbox_id:
              try: await delete_sandbox(sandbox_id)
              except Exception as e: logger.error(f"Error deleting sandbox: {str(e)}")
            raise Exception("Database update failed")

        # 3. Create Thread
        thread_data = {
            "thread_id": str(uuid.uuid4()),
            "project_id": project_id,
            "user_id": account_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        }

        structlog.contextvars.bind_contextvars(
            thread_id=thread_data["thread_id"],
            project_id=project_id,
            account_id=account_id,
        )

        thread = await client.table('threads').insert(thread_data).execute()
        thread_id = thread.data[0]['thread_id']
        logger.info(f"Created new thread: {thread_id}")

        # Trigger Background Naming Task
        asyncio.create_task(generate_and_update_project_name(project_id=project_id, prompt=prompt))

        # 4. Upload Files to Sandbox (if any)
        message_content = prompt
        if files:
            # Validate that all files are images
            for file in files:
                if file.filename and not is_image_file(file):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Only image files are allowed. Received file: {file.filename} with content type: {file.content_type}"
                    )
            
            async def upload_and_verify_file(file):
                """Helper function to handle one file's upload and verification."""
                if not file.filename:
                    return None, file.filename or "unnamed_file"
                
                try:
                    safe_filename = file.filename.replace('/', '_').replace('\\', '_')
                    # Use correct workspace path based on app_type
                    workspace_dir = "cheatcode-mobile" if app_type == 'mobile' else "cheatcode-app"
                    target_path = f"/workspace/{workspace_dir}/{safe_filename}"
                    logger.info(f"Attempting to upload {safe_filename} to {target_path} in sandbox {sandbox_id}")
                    content = await file.read()
                    upload_successful = False
                    
                    try:
                        if hasattr(sandbox, 'fs') and hasattr(sandbox.fs, 'upload_file'):
                            await sandbox.fs.upload_file(content, target_path)
                            logger.debug(f"Called sandbox.fs.upload_file for {target_path}")
                            upload_successful = True
                        else:
                            raise NotImplementedError("Suitable upload method not found on sandbox object.")
                    except Exception as upload_error:
                        logger.error(f"Error during sandbox upload call for {safe_filename}: {str(upload_error)}", exc_info=True)
                        return None, safe_filename

                    if upload_successful:
                        try:
                            # Optimize: Direct file existence check instead of listing entire directory
                            await asyncio.sleep(0.2)
                            try:
                                await sandbox.fs.stat(target_path)
                                logger.info(f"Successfully uploaded and verified file {safe_filename} to sandbox path {target_path}")
                                return target_path, None
                            except Exception as stat_error:
                                # File doesn't exist or stat failed
                                logger.error(f"Verification failed for {safe_filename}: File not found in {parent_dir} after upload attempt.")
                                return None, safe_filename
                        except Exception as verify_error:
                            logger.error(f"Error verifying file {safe_filename} after upload: {str(verify_error)}", exc_info=True)
                            return None, safe_filename
                    else:
                        return None, safe_filename
                        
                except Exception as file_error:
                    logger.error(f"Error processing file {file.filename}: {str(file_error)}", exc_info=True)
                    return None, file.filename
                finally:
                    await file.close()
            
            # Create upload tasks for all files and run them in parallel
            upload_tasks = [upload_and_verify_file(file) for file in files]
            results = await asyncio.gather(*upload_tasks, return_exceptions=True)
            
            # Process results
            successful_uploads = []
            failed_uploads = []
            for result in results:
                if isinstance(result, Exception):
                    logger.error(f"Upload task failed with exception: {result}")
                    failed_uploads.append("unknown_file")
                else:
                    success_path, failed_filename = result
                    if success_path:
                        successful_uploads.append(success_path)
                    elif failed_filename:
                        failed_uploads.append(failed_filename)

            if successful_uploads:
                message_content += "\n\n" if message_content else ""
                for file_path in successful_uploads: message_content += f"[Uploaded File: {file_path}]\n"
            if failed_uploads:
                message_content += "\n\nThe following files failed to upload:\n"
                for failed_file in failed_uploads: message_content += f"- {failed_file}\n"

        # 5. Add initial user message to thread
        message_id = str(uuid.uuid4())
        message_payload = {"role": "user", "content": message_content}
        await client.table('messages').insert({
            "message_id": message_id, "thread_id": thread_id, "type": "user",
            "is_llm_message": True, "content": json.dumps(message_payload),
            "created_at": datetime.now(timezone.utc).isoformat()
        }).execute()

        # Message usage tracking now handled by real-time token consumption in response_processor

        # 6. Start Agent Run
        agent_run = await client.table('agent_runs').insert({
            "thread_id": thread_id, "status": "running",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "model_name": model_name,
                "enable_thinking": enable_thinking,
                "reasoning_effort": reasoning_effort,
                "enable_context_manager": enable_context_manager
            }
        }).execute()
        agent_run_id = agent_run.data[0]['run_id']
        logger.info(f"Created new agent run: {agent_run_id}")
        structlog.contextvars.bind_contextvars(
            agent_run_id=agent_run_id,
        )

        # Register run in Redis
        instance_key = f"active_run:{instance_id}:{agent_run_id}"
        try:
            await redis.set(instance_key, "running", ex=redis.REDIS_KEY_TTL)
        except Exception as e:
            logger.warning(f"Failed to register agent run in Redis ({instance_key}): {str(e)}")

        # Queue background task for this agent run too
        request_id = str(uuid.uuid4())
        logger.info(f"Queuing background task for agent run {agent_run_id} from initiate endpoint")
        
        try:
            run_agent_background.run_agent_background.send(
                agent_run_id=agent_run_id,
                thread_id=thread_id,
                instance_id=instance_id,
                project_id=project_id,
                model_name=model_name,
                enable_thinking=enable_thinking,
                reasoning_effort=reasoning_effort,
                stream=stream,
                enable_context_manager=enable_context_manager,
                agent_config=agent_config,
                request_id=request_id,
                app_type=app_type
            )
            logger.info(f"Successfully queued background task for agent run {agent_run_id}")
        except Exception as e:
            logger.error(f"Failed to queue background task for agent run {agent_run_id}: {e}")
            # Update agent run status to failed
            await client.table('agent_runs').update({
                "status": "failed",
                "error": f"Failed to queue background task: {str(e)}",
                "completed_at": datetime.now(timezone.utc).isoformat()
            }).eq('run_id', agent_run_id).execute()
            raise HTTPException(status_code=500, detail=f"Failed to queue background task: {str(e)}")

        return {"thread_id": thread_id, "agent_run_id": agent_run_id}

    except Exception as e:
        logger.error(f"Error in agent initiation: {str(e)}\n{traceback.format_exc()}")
        # TODO: Clean up created project/thread if initiation fails mid-way
        raise HTTPException(status_code=500, detail=f"Failed to initiate agent session: {str(e)}")

# Custom agents

# Removed unused GET /agents endpoint - was only used by deleted useAgents hook

# Removed unused GET /agents/{agent_id} endpoint - was only used by deleted useAgent hook

# Removed unused POST /agents endpoint - was only used by deleted useCreateAgent hook

# Removed unused merge_custom_mcps function - was only used by deleted update_agent

# Removed unused PUT /agents/{agent_id} endpoint - was only used by deleted useUpdateAgent hook

# Removed unused DELETE /agents/{agent_id} endpoint - was only used by deleted useDeleteAgent hook

# Removed unused get_agent_builder_chat_history endpoint - was only used by deleted agent builder hooks

# Removed unused agent versioning endpoints - were only used by deleted agent version hooks
