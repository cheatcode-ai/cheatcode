import os
import json
import asyncio
from typing import Optional, Any

# MessageTool removed - not used in React/Next.js/Expo specialized agent
# from agent.tools.message_tool import MessageTool
# Deploy tool removed

from agent.tools.web_search_tool import SandboxWebSearchTool
from dotenv import load_dotenv
from utils.config import config

from agentpress.thread_manager import ThreadManager
from agentpress.response_processor import ProcessorConfig
from agent.tools.sb_shell_tool import SandboxShellTool
from agent.tools.sb_files_tool import SandboxFilesTool
from agent.tools.sb_lsp_tool import SandboxLSPTool
from agent.tools.expand_msg_tool import ExpandMessageTool
from agent.coding_agent_prompt import get_coding_agent_prompt
from agent.mobile_agent_prompt import get_mobile_agent_prompt
# Unused prompt import removed for React/Next.js/Expo specialization
# from agent.prompt import get_system_prompt
from utils.logger import logger
from utils.auth_utils import get_account_id_from_thread
from services.billing import check_billing_status
from agent.tools.sb_vision_tool import SandboxVisionTool
from services.langfuse import langfuse, safe_trace, log_event
# Unused prompt import removed for React/Next.js/Expo specialization  
# from agent.gemini_prompt import get_gemini_system_prompt
from agent.tools.mcp_tool_wrapper import MCPToolWrapper
from agentpress.tool import SchemaType

from agent.tools.component_search_tool import ComponentSearchTool
from agent.tools.completion_tool import CompletionTool
from utils.models import get_max_tokens_for_model

load_dotenv()

async def run_agent(
    thread_id: str,
    project_id: str,
    stream: bool,
    thread_manager: Optional[ThreadManager] = None,
    native_max_auto_continues: int = 25,
    max_iterations: int = 100,
    model_name: str = "openrouter/google/gemini-2.5-pro",
    enable_thinking: Optional[bool] = False,
    reasoning_effort: Optional[str] = 'low',
    enable_context_manager: bool = True,
    agent_config: Optional[dict] = None,
    trace: Optional[Any] = None,
    app_type: Optional[str] = 'web'
):
    """Run the development agent with specified configuration."""
    logger.info(f"🚀 Starting agent with model: {model_name}")
    if agent_config:
        logger.info(f"Using custom agent: {agent_config.get('name', 'Unknown')}")

    if not trace:
        trace = safe_trace(name="run_agent", session_id=thread_id, metadata={"project_id": project_id})
    thread_manager = ThreadManager(trace=trace, agent_config=agent_config)

    client = await thread_manager.db.client

    # Get account ID from thread for billing checks
    account_id = await get_account_id_from_thread(client, thread_id)
    if not account_id:
        raise ValueError("Could not determine account ID for thread")

    # Get sandbox info from project
    project = await client.table('projects').select('*').eq('project_id', project_id).execute()
    if not project.data or len(project.data) == 0:
        raise ValueError(f"Project {project_id} not found")

    project_data = project.data[0]
    sandbox_info = project_data.get('sandbox', {})
    if not sandbox_info.get('id'):
        raise ValueError(f"No sandbox found for project {project_id}")

    # Initialize tools with project_id instead of sandbox object
    # This ensures each tool independently verifies it's operating on the correct project
    
    # Get enabled tools from agent config, or use defaults
    enabled_tools = None
    if agent_config and 'agentpress_tools' in agent_config:
        enabled_tools = agent_config['agentpress_tools']
        logger.info(f"Using custom tool configuration from agent")
    
    # Register tools based on configuration
    # If no agent config (enabled_tools is None), register ALL tools for full capabilities
    # If agent config exists, only register explicitly enabled tools
    if enabled_tools is None:
        # No agent specified - register ALL tools for full experience
        logger.info("No agent specified - registering all tools for full capabilities")
        thread_manager.add_tool(SandboxShellTool, project_id=project_id, thread_manager=thread_manager, app_type=app_type)
        thread_manager.add_tool(SandboxFilesTool, project_id=project_id, thread_manager=thread_manager, app_type=app_type)
        # Deploy tool removed
        # Expose tool removed - preview URLs are pre-generated and passed to agent
        thread_manager.add_tool(ExpandMessageTool, thread_id=thread_id, thread_manager=thread_manager)
        # MessageTool removed - not used in React/Next.js/Expo specialized agent
        thread_manager.add_tool(SandboxWebSearchTool, project_id=project_id, thread_manager=thread_manager, app_type=app_type)
        thread_manager.add_tool(SandboxVisionTool, project_id=project_id, thread_id=thread_id, thread_manager=thread_manager, app_type=app_type)
        # Register unified Smart Template tool
        # thread_manager.add_tool(SmartTemplateTool, project_id=project_id, thread_manager=thread_manager)  # Disabled for testing manual component discovery

        # Register LSP tool for intelligent code completions and navigation
        thread_manager.add_tool(SandboxLSPTool, project_id=project_id, thread_manager=thread_manager, app_type=app_type)

        # Register component search tool for embedding-based component discovery
        thread_manager.add_tool(ComponentSearchTool, thread_manager=thread_manager, app_type=app_type)
        # Register completion tool for task termination
        thread_manager.add_tool(CompletionTool, thread_manager=thread_manager, app_type=app_type)
    else:
        logger.info("Custom agent specified - registering only enabled tools")
        thread_manager.add_tool(ExpandMessageTool, thread_id=thread_id, thread_manager=thread_manager)
        # MessageTool removed - not used in React/Next.js/Expo specialized agent
        if enabled_tools.get('sb_shell_tool', {}).get('enabled', False):
            thread_manager.add_tool(SandboxShellTool, project_id=project_id, thread_manager=thread_manager, app_type=app_type)
        if enabled_tools.get('sb_files_tool', {}).get('enabled', False):
            thread_manager.add_tool(SandboxFilesTool, project_id=project_id, thread_manager=thread_manager, app_type=app_type)

        # --- Fallback: always have basic file access ---
        # Some custom agent configurations forget to enable sb_files_tool which leads
        # to missing functions like <read-file>. Ensure it is registered once.
        if 'read_file' not in thread_manager.tool_registry.get_available_functions():
            logger.info("sb_files_tool not explicitly enabled – registering by default for essential file operations")
            thread_manager.add_tool(SandboxFilesTool, project_id=project_id, thread_manager=thread_manager, app_type=app_type)

        # Deploy tool removed
        # if enabled_tools.get('sb_deploy_tool', {}).get('enabled', False):
        #     thread_manager.add_tool(SandboxDeployTool, project_id=project_id, thread_manager=thread_manager)
        # Expose tool removed - preview URLs are pre-generated and passed to agent
        # if enabled_tools.get('sb_expose_tool', {}).get('enabled', False):
        #     thread_manager.add_tool(SandboxExposeTool, project_id=project_id, thread_manager=thread_manager)
        if enabled_tools.get('web_search_tool', {}).get('enabled', False):
            thread_manager.add_tool(SandboxWebSearchTool, project_id=project_id, thread_manager=thread_manager, app_type=app_type)
        if enabled_tools.get('sb_vision_tool', {}).get('enabled', False):
            thread_manager.add_tool(SandboxVisionTool, project_id=project_id, thread_id=thread_id, thread_manager=thread_manager, app_type=app_type)

        # Register LSP tool for code intelligence (disabled by default - advanced feature)
        if enabled_tools.get('sb_lsp_tool', {}).get('enabled', False):
            thread_manager.add_tool(SandboxLSPTool, project_id=project_id, thread_manager=thread_manager, app_type=app_type)

        # Register component search tool if enabled in agent config (default: enabled for coding workflows)
        if enabled_tools.get('component_search_tool', {}).get('enabled', True):
            thread_manager.add_tool(ComponentSearchTool, thread_manager=thread_manager, app_type=app_type)
        # Register completion tool for task termination (always enabled for custom agents)
        thread_manager.add_tool(CompletionTool, thread_manager=thread_manager, app_type=app_type)
        
        # Always register completion tool for proper task termination
        thread_manager.add_tool(CompletionTool, thread_manager=thread_manager, app_type=app_type)

    # Register MCP tool wrapper if agent has configured MCPs or custom MCPs
    mcp_wrapper_instance = None
    logger.info(f"[MCP DEBUG run.py] Checking agent_config for MCPs...")
    if agent_config:
        logger.info(f"[MCP DEBUG run.py] agent_config keys: {list(agent_config.keys())}")
        logger.info(f"[MCP DEBUG run.py] configured_mcps count: {len(agent_config.get('configured_mcps', []))}")

        # Get configured MCPs (via Composio)
        all_mcps = agent_config.get('configured_mcps', [])

        if all_mcps:
            logger.info(f"[MCP DEBUG run.py] Adding {len(all_mcps)} configured MCPs: {[mcp.get('qualifiedName') for mcp in all_mcps]}")
            logger.info(f"[MCP DEBUG run.py] Registering MCP tool wrapper for {len(all_mcps)} MCP servers")
            thread_manager.add_tool(MCPToolWrapper, mcp_configs=all_mcps)
            
            for tool_name, tool_info in thread_manager.tool_registry.tools.items():
                if isinstance(tool_info['instance'], MCPToolWrapper):
                    mcp_wrapper_instance = tool_info['instance']
                    break
            
            if mcp_wrapper_instance:
                try:
                    await mcp_wrapper_instance.initialize_and_register_tools()
                    logger.info("MCP tools initialized successfully")
                    updated_schemas = mcp_wrapper_instance.get_schemas()
                    logger.info(f"MCP wrapper has {len(updated_schemas)} schemas available")
                    for method_name, schema_list in updated_schemas.items():
                        if method_name != 'call_mcp_tool':
                            for schema in schema_list:
                                if schema.schema_type == SchemaType.OPENAPI:
                                    thread_manager.tool_registry.tools[method_name] = {
                                        "instance": mcp_wrapper_instance,
                                        "schema": schema
                                    }
                                    logger.info(f"Registered dynamic MCP tool: {method_name}")
                    
                    # Log all registered tools for debugging
                    all_tools = list(thread_manager.tool_registry.tools.keys())
                    logger.info(f"All registered tools after MCP initialization: {all_tools}")
                    mcp_tools = [tool for tool in all_tools if tool not in ['call_mcp_tool', 'sb_files_tool', 'expand_msg_tool', 'web_search_tool', 'sb_shell_tool', 'sb_vision_tool']]
                    logger.info(f"MCP tools registered: {mcp_tools}")
                
                except Exception as e:
                    logger.error(f"Failed to initialize MCP tools: {e}")
                    # Continue without MCP tools if initialization fails

    # Get actual preview URL from auto-preview system
    sandbox_id = sandbox_info.get('id')
    # Set fallback URL based on app_type
    if app_type == 'mobile':
        preview_url = 'https://localhost:8081'  # Expo Metro bundler fallback
    else:
        preview_url = 'https://localhost:3000'  # Next.js dev server fallback
    dev_server_status = 'unknown'
    
    if sandbox_id:
        try:
            # Import here to avoid circular imports
            from sandbox.api import get_sandbox_preview_url, get_sandbox_by_id_safely
            from utils.auth_utils import get_optional_user_id
            from fastapi import Request
            from services.supabase import DBConnection
            
            # Create a mock request for the preview URL endpoint
            class MockRequest:
                def __init__(self):
                    self.headers = {}
                    self.query_params = {}
                    self.url = type('MockURL', (), {'query': ''})()
            
            mock_request = MockRequest()
            
            # Get preview URL based on app_type
            if app_type == 'mobile':
                # For mobile apps, get Expo Metro bundler preview (port 8081)
                try:
                    db_conn = DBConnection()
                    await db_conn.initialize()
                    client = await db_conn.client
                    sandbox = await get_sandbox_by_id_safely(client, sandbox_id)
                    preview_info = await sandbox.get_preview_link(8081)
                    preview_response = {
                        "preview_url": preview_info.url if hasattr(preview_info, 'url') else str(preview_info),
                        "status": "available"
                    }
                    logger.info(f"Retrieved mobile preview URL (port 8081) for agent")
                except Exception as mobile_preview_error:
                    # Expected if Expo dev server not running yet - use debug level
                    logger.debug(f"Could not get mobile preview link (port 8081) - expected if Expo not started: {str(mobile_preview_error)}")
                    preview_response = {"preview_url": None, "status": "preview_not_available"}
            else:
                # For web apps, use the existing function (port 3000)
                preview_response = await get_sandbox_preview_url(
                    sandbox_id=sandbox_id,
                    request=mock_request,
                    user_id=None  # Use service account for agent calls
                )
            
            if preview_response and preview_response.get('preview_url'):
                preview_url = preview_response['preview_url']
                dev_server_status = preview_response.get('status', 'available')
                logger.info(f"Retrieved live preview URL for agent: {preview_url}")
            else:
                dev_server_status = preview_response.get('status', 'dev_server_not_running') if preview_response else 'unknown'
                logger.info(f"Preview URL not available, status: {dev_server_status}")
                
        except Exception as e:
            # This is expected when dev server isn't running yet - use debug level
            logger.debug(f"Could not get live preview URL for agent (expected if dev server not ready): {str(e)}")
            # Use fallback URL
    
    logger.info(f"Using preview URL for agent: {preview_url} (status: {dev_server_status})")

    # Prepare system prompt with enhanced preview context
    # Route between coding agent prompt (web) and mobile agent prompt based on app_type
    if app_type == 'mobile':
        default_system_content = get_mobile_agent_prompt(preview_url=preview_url)
        logger.info(f"Using mobile agent prompt for app_type: {app_type}")
    else:
        default_system_content = get_coding_agent_prompt(preview_url=preview_url)
        logger.info(f"Using web coding agent prompt for app_type: {app_type}")
    
    # Add auto-preview system context to agent
    auto_preview_context = f"\n\n## AUTO-PREVIEW SYSTEM STATUS\n"
    auto_preview_context += f"- Sandbox ID: {sandbox_id}\n"
    auto_preview_context += f"- Preview URL: {preview_url}\n"
    auto_preview_context += f"- Dev Server Status: {dev_server_status}\n"
    if dev_server_status == 'available':
        auto_preview_context += "- ✅ Auto-preview is ACTIVE - changes will update instantly via hot-reload\n"
        auto_preview_context += "- 🎯 Focus on creating content - preview loads automatically in UI\n"
    elif dev_server_status == 'dev_server_not_running':
        auto_preview_context += "- 🚧 Dev server will auto-start when user opens preview panel\n"
        auto_preview_context += "- 📝 Focus on creating content - preview will load automatically\n"
    else:
        auto_preview_context += "- ⚠️ Preview status unknown - continue with development\n"
    
    default_system_content += auto_preview_context
        
    # Add sample response for non-anthropic models
    if "anthropic" not in model_name.lower():
        sample_response_path = os.path.join(os.path.dirname(__file__), 'sample_responses/1.txt')
        with open(sample_response_path, 'r') as file:
            sample_response = file.read()
        default_system_content = default_system_content + "\n\n <sample_assistant_response>" + sample_response + "</sample_assistant_response>"
    
    # Handle custom agent system prompt
    if agent_config and agent_config.get('system_prompt'):
        custom_system_prompt = agent_config['system_prompt'].strip()
        
        # Completely replace the default system prompt with the custom one
        # This prevents confusion and tool hallucination
        system_content = custom_system_prompt
        logger.info(f"Using ONLY custom agent system prompt for: {agent_config.get('name', 'Unknown')}")
    else:
        # Use the Coding Agent prompt as default
        system_content = default_system_content
        logger.info("Using Coding Agent system prompt")
    



    if agent_config and agent_config.get('configured_mcps') and mcp_wrapper_instance and mcp_wrapper_instance._initialized:
        mcp_info = "\n\n--- MCP Tools Available ---\n"
        mcp_info += "You have access to external MCP (Model Context Protocol) server tools.\n"
        mcp_info += "MCP tools can be called directly using their native function names in the standard function calling format:\n"
        mcp_info += '<function_calls>\n'
        mcp_info += '<invoke name="{tool_name}">\n'
        mcp_info += '<parameter name="param1">value1</parameter>\n'
        mcp_info += '<parameter name="param2">value2</parameter>\n'
        mcp_info += '</invoke>\n'
        mcp_info += '</function_calls>\n\n'
        
        # List available MCP tools
        mcp_info += "Available MCP tools:\n"
        try:
            # Get the actual registered schemas from the wrapper
            registered_schemas = mcp_wrapper_instance.get_schemas()
            for method_name, schema_list in registered_schemas.items():
                if method_name == 'call_mcp_tool':
                    continue  # Skip the fallback method
                    
                # Get the schema info
                for schema in schema_list:
                    if schema.schema_type == SchemaType.OPENAPI:
                        func_info = schema.schema.get('function', {})
                        # description might occasionally be a list or other type
                        raw_description = func_info.get('description', 'No description available')
                        description = raw_description if isinstance(raw_description, str) else str(raw_description)
                        # Extract server name from description if available
                        server_match = description.find('(MCP Server: ')
                        if server_match != -1:
                            server_end = description.find(')', server_match)
                            server_info = description[server_match:server_end+1]
                        else:
                            server_info = ''
                        
                        mcp_info += f"- **{method_name}**: {description}\n"
                        
                        # Show parameter info
                        params = func_info.get('parameters', {})
                        props = params.get('properties', {})
                        if props:
                            mcp_info += f"  Parameters: {', '.join(props.keys())}\n"
                            
        except Exception as e:
            logger.error(f"Error listing MCP tools: {e}")
            mcp_info += "- Error loading MCP tool list\n"
        
        # Add critical instructions for using search results
        mcp_info += "\n🚨 CRITICAL MCP TOOL RESULT INSTRUCTIONS 🚨\n"
        mcp_info += "When you use ANY MCP (Model Context Protocol) tools:\n"
        mcp_info += "1. ALWAYS read and use the EXACT results returned by the MCP tool\n"
        mcp_info += "2. For search tools: ONLY cite URLs, sources, and information from the actual search results\n"
        mcp_info += "3. For any tool: Base your response entirely on the tool's output - do NOT add external information\n"
        mcp_info += "4. DO NOT fabricate, invent, hallucinate, or make up any sources, URLs, or data\n"
        mcp_info += "5. If you need more information, call the MCP tool again with different parameters\n"
        mcp_info += "6. When writing reports/summaries: Reference ONLY the data from MCP tool results\n"
        mcp_info += "7. If the MCP tool doesn't return enough information, explicitly state this limitation\n"
        mcp_info += "8. Always double-check that every fact, URL, and reference comes from the MCP tool output\n"
        mcp_info += "\nIMPORTANT: MCP tool results are your PRIMARY and ONLY source of truth for external data!\n"
        mcp_info += "NEVER supplement MCP results with your training data or make assumptions beyond what the tools provide.\n"
        
        system_content += mcp_info
    
    system_message = { "role": "system", "content": system_content }

    iteration_count = 0
    continue_execution = True

    latest_user_message = await client.table('messages').select('*').eq('thread_id', thread_id).eq('type', 'user').order('created_at', desc=True).limit(1).execute()
    if latest_user_message.data and len(latest_user_message.data) > 0:
        data = latest_user_message.data[0]['content']
        if isinstance(data, str):
            data = json.loads(data)
        if trace:
            trace.update(input=data['content'])

    while continue_execution and iteration_count < max_iterations:
        iteration_count += 1
        logger.info(f"🔄 Running iteration {iteration_count} of {max_iterations}...")

        # Billing check on each iteration - still needed within the iterations
        can_run, message, subscription = await check_billing_status(client, account_id)
        if not can_run:
            error_msg = f"Billing limit reached: {message}"
            if trace:
                log_event(trace,name="billing_limit_reached", level="ERROR", status_message=f"{error_msg}")
            # Yield a special message to indicate billing limit reached
            yield {
                "type": "status",
                "status": "stopped",
                "message": error_msg
            }
            break
        # Check if last message is from assistant using direct Supabase query
        latest_message = await client.table('messages').select('*').eq('thread_id', thread_id).in_('type', ['assistant', 'tool', 'user']).order('created_at', desc=True).limit(1).execute()
        if latest_message.data and len(latest_message.data) > 0:
            message_type = latest_message.data[0].get('type')
            if message_type == 'assistant':
                logger.info(f"Last message was from assistant, stopping execution")
                if trace:
                    log_event(trace,name="last_message_from_assistant", level="DEFAULT", status_message="Last message was from assistant, stopping execution")
                continue_execution = False
                break

        # ---- Temporary Message Handling (Image Context) ----
        temporary_message = None
        temp_message_content_list = [] # List to hold text/image blocks

        # Get the latest image_context message
        latest_image_context_msg = await client.table('messages').select('*').eq('thread_id', thread_id).eq('type', 'image_context').order('created_at', desc=True).limit(1).execute()
        if latest_image_context_msg.data and len(latest_image_context_msg.data) > 0:
            try:
                image_context_content = latest_image_context_msg.data[0]["content"] if isinstance(latest_image_context_msg.data[0]["content"], dict) else json.loads(latest_image_context_msg.data[0]["content"])
                base64_image = image_context_content.get("base64")
                mime_type = image_context_content.get("mime_type")
                file_path = image_context_content.get("file_path", "unknown file")

                if base64_image and mime_type:
                    temp_message_content_list.append({
                        "type": "text",
                        "text": f"Here is the image you requested to see: '{file_path}'"
                    })
                    temp_message_content_list.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{base64_image}",
                        }
                    })
                else:
                    logger.warning(f"Image context found for '{file_path}' but missing base64 or mime_type.")

                await client.table('messages').delete().eq('message_id', latest_image_context_msg.data[0]["message_id"]).execute()
            except Exception as e:
                logger.error(f"Error parsing image context: {e}")
                if trace:
                    log_event(trace,name="error_parsing_image_context", level="ERROR", status_message=f"{e}")

        # If we have any content, construct the temporary_message
        if temp_message_content_list:
            temporary_message = {"role": "user", "content": temp_message_content_list}
            # logger.debug(f"Constructed temporary message with {len(temp_message_content_list)} content blocks.")
        # ---- End Temporary Message Handling ----

        # Get max_tokens from single source of truth (utils/models.py)
        max_tokens = get_max_tokens_for_model(model_name)
            
        generation = trace.start_generation(name="thread_manager.run_thread") if trace else None
        try:
            # Make the LLM call and process the response
            response = await thread_manager.run_thread(
                thread_id=thread_id,
                system_prompt=system_message,
                stream=stream,
                llm_model=model_name,
                llm_temperature=0,
                llm_max_tokens=max_tokens,
                tool_choice="auto",
                max_xml_tool_calls=0,  # 0 = no limit, allows parallel execution
                temporary_message=temporary_message,
                processor_config=ProcessorConfig(
                    xml_tool_calling=True,
                    native_tool_calling=False,
                    execute_tools=True,
                    execute_on_stream=True,
                    tool_execution_strategy="parallel",
                    xml_adding_strategy="user_message"
                ),
                native_max_auto_continues=native_max_auto_continues,
                include_xml_examples=True,
                enable_thinking=enable_thinking,
                reasoning_effort=reasoning_effort,
                enable_context_manager=enable_context_manager,
                generation=generation
            )

            if isinstance(response, dict) and "status" in response and response["status"] == "error":
                logger.error(f"Error response from run_thread: {response.get('message', 'Unknown error')}")
                if trace:
                    log_event(trace,name="error_response_from_run_thread", level="ERROR", status_message=f"{response.get('message', 'Unknown error')}")
                yield response
                break

            # Track if we see ask, complete, or web-browser-takeover tool calls
            last_tool_call = None
            agent_should_terminate = False

            # Process the response
            error_detected = False
            full_response = ""
            try:
                # Check if response is iterable (async generator) or a dict (error case)
                if hasattr(response, '__aiter__') and not isinstance(response, dict):
                    async for chunk in response:
                        # If we receive an error chunk, we should stop after this iteration
                        if isinstance(chunk, dict) and chunk.get('type') == 'status' and chunk.get('status') == 'error':
                            logger.error(f"Error chunk detected: {chunk.get('message', 'Unknown error')}")
                            if trace:
                                log_event(trace,name="error_chunk_detected", level="ERROR", status_message=f"{chunk.get('message', 'Unknown error')}")
                            error_detected = True
                            yield chunk  # Forward the error chunk
                            continue     # Continue processing other chunks but don't break yet
                        
                        # Check for termination signal in status messages
                        if chunk.get('type') == 'status':
                            try:
                                # Parse the metadata to check for termination signal
                                metadata = chunk.get('metadata', {})
                                if isinstance(metadata, str):
                                    metadata = json.loads(metadata)
                                
                                if metadata.get('agent_should_terminate'):
                                    agent_should_terminate = True
                                    logger.info("Agent termination signal detected in status message")
                                    if trace:
                                        log_event(trace,name="agent_termination_signal_detected", level="DEFAULT", status_message="Agent termination signal detected in status message")
                                    
                                    # Extract the tool name from the status content if available
                                    content = chunk.get('content', {})
                                    if isinstance(content, str):
                                        content = json.loads(content)
                                    
                                    if content.get('function_name'):
                                        last_tool_call = content['function_name']
                                    elif content.get('xml_tag_name'):
                                        last_tool_call = content['xml_tag_name']
                                        
                            except Exception as e:
                                logger.debug(f"Error parsing status message for termination check: {e}")
                            
                        # Check for XML versions like <ask>, <complete>, or <web-browser-takeover> in assistant content chunks
                        if chunk.get('type') == 'assistant' and 'content' in chunk:
                            try:
                                # The content field might be a JSON string or object
                                content = chunk.get('content', '{}')
                                if isinstance(content, str):
                                    assistant_content_json = json.loads(content)
                                else:
                                    assistant_content_json = content

                                # The actual text content is nested within
                                assistant_text = assistant_content_json.get('content', '')

                                # assistant_text can be a str or a list (when multiple blocks). Normalize to string.
                                if isinstance(assistant_text, list):
                                    assistant_text_str = "".join(str(part) for part in assistant_text)
                                else:
                                    assistant_text_str = str(assistant_text)

                                full_response += assistant_text_str
                                if '</ask>' in assistant_text_str or '</complete>' in assistant_text_str or '</web-browser-takeover>' in assistant_text_str:
                                       if '</ask>' in assistant_text_str:
                                           xml_tool = 'ask'
                                       elif '</complete>' in assistant_text_str:
                                           xml_tool = 'complete'
                                       elif '</web-browser-takeover>' in assistant_text_str:
                                           xml_tool = 'web-browser-takeover'

                                       last_tool_call = xml_tool
                                       logger.info(f"Agent used XML tool: {xml_tool}")
                                       if trace:
                                           log_event(trace,name="agent_used_xml_tool", level="DEFAULT", status_message=f"Agent used XML tool: {xml_tool}")
                            
                            except json.JSONDecodeError:
                                # Handle cases where content might not be valid JSON
                                logger.warning(f"Warning: Could not parse assistant content JSON: {chunk.get('content')}")
                                if trace:
                                    log_event(trace,name="warning_could_not_parse_assistant_content_json", level="WARNING", status_message=f"Warning: Could not parse assistant content JSON: {chunk.get('content')}")
                            except Exception as e:
                                logger.error(f"Error processing assistant chunk: {e}")
                                if trace:
                                    log_event(trace,name="error_processing_assistant_chunk", level="ERROR", status_message=f"Error processing assistant chunk: {e}")

                        yield chunk
                else:
                    # Response is not iterable, likely an error dict
                    logger.error(f"Response is not iterable: {response}")
                    error_detected = True

                # Check if we should stop based on the last tool call or error
                if error_detected:
                    logger.info(f"Stopping due to error detected in response")
                    if trace:
                        log_event(trace,name="stopping_due_to_error_detected_in_response", level="DEFAULT", status_message="Stopping due to error detected in response")
                    if generation:
                        generation.end(output=full_response, status_message="error_detected", level="ERROR")
                    break
                    
                if agent_should_terminate:
                    logger.info(f"Agent decided to stop based on agent_should_terminate flag")
                    if trace:
                        log_event(trace,name="agent_decided_to_stop", level="DEFAULT", status_message="Agent decided to stop based on agent_should_terminate flag")
                    if generation:
                        generation.end(output=full_response, status_message="agent_stopped")
                    continue_execution = False

            except Exception as e:
                # Just log the error and re-raise to stop all iterations
                error_msg = f"Error during response streaming: {str(e)}"
                logger.error(f"Error: {error_msg}")
                if trace:
                    log_event(trace,name="error_during_response_streaming", level="ERROR", status_message=f"Error during response streaming: {str(e)}")
                if generation:
                    generation.end(output=full_response, status_message=error_msg, level="ERROR")
                yield {
                    "type": "status",
                    "status": "error",
                    "message": error_msg
                }
                # Stop execution immediately on any error
                break
                
        except Exception as e:
            # Just log the error and re-raise to stop all iterations
            error_msg = f"Error running thread: {str(e)}"
            logger.error(f"Error: {error_msg}")
            if trace:
                log_event(trace,name="error_running_thread", level="ERROR", status_message=f"Error running thread: {str(e)}")
            yield {
                "type": "status",
                "status": "error",
                "message": error_msg
            }
            # Stop execution immediately on any error
            break
        if generation:
            generation.end(output=full_response)

    try:
        # Traces auto-complete in Langfuse - no need to manually end them
        if trace:
            logger.debug("Langfuse trace will auto-complete")
    except Exception as trace_error:
        logger.warning(f"Error with Langfuse trace: {str(trace_error)}")
    
    # Flush Langfuse data asynchronously
    try:
        if langfuse:
            asyncio.create_task(asyncio.to_thread(lambda: langfuse.flush()))
    except Exception as flush_error:
        logger.warning(f"Error flushing Langfuse data: {str(flush_error)}")
