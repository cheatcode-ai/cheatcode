"""
Conversation thread management system for AgentPress.

This module provides comprehensive conversation management, including:
- Thread creation and persistence
- Message handling with support for text and images
- Tool registration and execution
- LLM interaction with streaming support
- Error handling and cleanup
- Context summarization to manage token limits
"""

import json
import time
from typing import List, Dict, Any, Optional, Type, Union, AsyncGenerator, Literal, cast
from services.llm import make_llm_api_call
from services.api_key_resolver import APIKeyResolver
from utils.config import config
from agentpress.tool import Tool
from agentpress.tool_registry import ToolRegistry
from agentpress.context_manager import ContextManager
from agentpress.response_processor import (
    ResponseProcessor,
    ProcessorConfig
)
from services.supabase import DBConnection
from utils.logger import logger
from langfuse.client import StatefulGenerationClient, StatefulTraceClient
from services.langfuse import langfuse, safe_trace
import datetime
from litellm.utils import token_counter

# Type alias for tool choice
ToolChoice = Literal["auto", "required", "none"]

class ThreadManager:
    """Manages conversation threads with LLM models and tool execution.

    Provides comprehensive conversation management, handling message threading,
    tool registration, and LLM interactions with support for both standard and
    XML-based tool execution patterns.
    """

    def __init__(self, trace: Optional[StatefulTraceClient] = None, is_agent_builder: bool = False, target_agent_id: Optional[str] = None, agent_config: Optional[dict] = None):
        """Initialize ThreadManager.

        Args:
            trace: Optional trace client for logging
            is_agent_builder: Whether this is an agent builder session
            target_agent_id: ID of the agent being built (if in agent builder mode)
            agent_config: Optional agent configuration with version information
        """
        self.db = DBConnection()
        self.tool_registry = ToolRegistry()
        self.trace = trace
        self.is_agent_builder = is_agent_builder
        self.target_agent_id = target_agent_id
        self.agent_config = agent_config
        
        # Performance optimization: Cache system key (plan caching now centralized in APIKeyResolver)
        self._system_openrouter_key = config.OPENROUTER_API_KEY
        if not self.trace:
            self.trace = safe_trace(name="anonymous:thread_manager")
        self.response_processor = ResponseProcessor(
            tool_registry=self.tool_registry,
            add_message_callback=self.add_message,
            trace=self.trace,
            is_agent_builder=self.is_agent_builder,
            target_agent_id=self.target_agent_id,
            agent_config=self.agent_config
        )
        self.context_manager = ContextManager()

    def add_tool(self, tool_class: Type[Tool], function_names: Optional[List[str]] = None, **kwargs):
        """Add a tool to the ThreadManager."""
        self.tool_registry.register_tool(tool_class, function_names, **kwargs)

    async def add_message(
        self,
        thread_id: str,
        type: str,
        content: Union[Dict[str, Any], List[Any], str],
        is_llm_message: bool = False,
        metadata: Optional[Dict[str, Any]] = None,
        agent_id: Optional[str] = None,
        agent_version_id: Optional[str] = None
    ):
        """Add a message to the thread in the database.

        Args:
            thread_id: The ID of the thread to add the message to.
            type: The type of the message (e.g., 'text', 'image_url', 'tool_call', 'tool', 'user', 'assistant').
            content: The content of the message. Can be a dictionary, list, or string.
                     It will be stored as JSONB in the database.
            is_llm_message: Flag indicating if the message originated from the LLM.
                            Defaults to False (user message).
            metadata: Optional dictionary for additional message metadata.
                      Defaults to None, stored as an empty JSONB object if None.
            agent_id: Optional ID of the agent associated with this message.
            agent_version_id: Optional ID of the specific agent version used.
        """
        logger.debug(f"Adding message of type '{type}' to thread {thread_id} (agent: {agent_id}, version: {agent_version_id})")
        client = await self.db.client

        # Prepare data for insertion
        data_to_insert = {
            'thread_id': thread_id,
            'type': type,
            'content': content,
            'is_llm_message': is_llm_message,
            'metadata': metadata or {},
        }
        
        # Add agent information if provided
        if agent_id:
            data_to_insert['agent_id'] = agent_id
        if agent_version_id:
            data_to_insert['agent_version_id'] = agent_version_id

        try:
            # Insert the message and get the inserted row data including the id
            result = await client.table('messages').insert(data_to_insert).execute()
            logger.info(f"Successfully added message to thread {thread_id}")

            if result.data and len(result.data) > 0 and isinstance(result.data[0], dict) and 'message_id' in result.data[0]:
                return result.data[0]
            else:
                logger.error(f"Insert operation failed or did not return expected data structure for thread {thread_id}. Result data: {result.data}")
                return None
        except Exception as e:
            logger.error(f"Failed to add message to thread {thread_id}: {str(e)}", exc_info=True)
            raise

    async def get_llm_messages(self, thread_id: str) -> List[Dict[str, Any]]:
        """Get all messages for a thread.

        This method uses the SQL function which handles context truncation
        by considering summary messages.

        Args:
            thread_id: The ID of the thread to get messages for.

        Returns:
            List of message objects.
        """
        logger.debug(f"Getting messages for thread {thread_id}")
        client = await self.db.client

        try:
            # result = await client.rpc('get_llm_formatted_messages', {'p_thread_id': thread_id}).execute()
            
            # Fetch messages in batches with proper ordering guarantees
            all_messages = []
            batch_size = 1000
            offset = 0
            last_created_at = None
            
            # Use cursor-based pagination for consistent ordering
            while True:
                query = client.table('messages').select('message_id, content, created_at').eq('thread_id', thread_id).eq('is_llm_message', True)
                
                if last_created_at:
                    # Use created_at cursor for consistent pagination
                    query = query.gt('created_at', last_created_at)
                    
                query = query.order('created_at').limit(batch_size)
                result = await query.execute()
                
                if not result.data or len(result.data) == 0:
                    break
                    
                batch_messages = result.data
                all_messages.extend(batch_messages)
                
                # Update cursor for next iteration
                if batch_messages:
                    last_created_at = batch_messages[-1]['created_at']
                
                # If we got fewer than batch_size records, we've reached the end
                if len(batch_messages) < batch_size:
                    break
            
            # Final sort to ensure absolute ordering (in case of identical timestamps)
            all_messages.sort(key=lambda x: (x['created_at'], x['message_id']))
            
            # Use all_messages instead of result.data in the rest of the method
            result_data = all_messages

            # Parse the returned data which might be stringified JSON
            if not result_data:
                return []

            # Return properly parsed JSON objects with order preservation
            messages = []
            message_order = {}  # Track original order by message_id
            
            for index, item in enumerate(result_data):
                try:
                    if isinstance(item['content'], str):
                        try:
                            parsed_item = json.loads(item['content'])
                            parsed_item['message_id'] = item['message_id']
                            parsed_item['_order'] = index  # Add order tracking
                            messages.append(parsed_item)
                            message_order[item['message_id']] = index
                        except json.JSONDecodeError as e:
                            logger.error(f"Failed to parse message {item.get('message_id', 'unknown')}: {item['content']}. Error: {e}")
                            # Create a placeholder for unparseable messages to maintain order
                            placeholder = {
                                'role': 'system',
                                'content': '[Message parsing failed]',
                                'message_id': item['message_id'],
                                '_order': index,
                                '_parse_error': True
                            }
                            messages.append(placeholder)
                            message_order[item['message_id']] = index
                    else:
                        content = item['content'].copy() if isinstance(item['content'], dict) else item['content']
                        if isinstance(content, dict):
                            content['message_id'] = item['message_id']
                            content['_order'] = index
                        messages.append(content)
                        message_order[item['message_id']] = index
                except Exception as e:
                    logger.error(f"Error processing message {item.get('message_id', 'unknown')}: {e}")
                    # Continue processing other messages
            
            # Final verification of message order
            messages.sort(key=lambda x: x.get('_order', 0))
            
            # Remove order tracking field before returning
            for msg in messages:
                if isinstance(msg, dict) and '_order' in msg:
                    del msg['_order']

            logger.debug(f"Retrieved {len(messages)} messages for thread {thread_id} in proper order")
            return messages

        except Exception as e:
            logger.error(f"Failed to get messages for thread {thread_id}: {str(e)}", exc_info=True)
            return []

    async def run_thread(
        self,
        thread_id: str,
        system_prompt: Dict[str, Any],
        stream: bool = True,
        temporary_message: Optional[Dict[str, Any]] = None,
        llm_model: str = "openrouter/google/gemini-2.5-pro",
        llm_temperature: float = 0,
        llm_max_tokens: Optional[int] = None,
        processor_config: Optional[ProcessorConfig] = None,
        tool_choice: ToolChoice = "auto",
        native_max_auto_continues: int = 25,
        max_xml_tool_calls: int = 0,
        include_xml_examples: bool = False,
        enable_thinking: Optional[bool] = False,
        reasoning_effort: Optional[str] = 'low',
        enable_context_manager: bool = True,
        generation: Optional[StatefulGenerationClient] = None,
    ) -> Union[Dict[str, Any], AsyncGenerator]:
        """Run a conversation thread with LLM integration and tool execution.

        Args:
            thread_id: The ID of the thread to run
            system_prompt: System message to set the assistant's behavior
            stream: Use streaming API for the LLM response
            temporary_message: Optional temporary user message for this run only
            llm_model: The name of the LLM model to use
            llm_temperature: Temperature parameter for response randomness (0-1)
            llm_max_tokens: Maximum tokens in the LLM response
            processor_config: Configuration for the response processor
            tool_choice: Tool choice preference ("auto", "required", "none")
            native_max_auto_continues: Maximum number of automatic continuations when
                                      finish_reason="tool_calls" (0 disables auto-continue)
            max_xml_tool_calls: Maximum number of XML tool calls to allow (0 = no limit)
            include_xml_examples: Whether to include XML tool examples in the system prompt
            enable_thinking: Whether to enable thinking before making a decision
            reasoning_effort: The effort level for reasoning
            enable_context_manager: Whether to enable automatic context summarization (default: True).

        Returns:
            An async generator yielding response chunks or error dict
        """

        logger.info(f"Starting thread execution for thread {thread_id}")
        logger.info(f"Using model: {llm_model}")
        # Log parameters
        logger.info(f"Parameters: model={llm_model}, temperature={llm_temperature}, max_tokens={llm_max_tokens}")
        logger.info(f"Auto-continue: max={native_max_auto_continues}, XML tool limit={max_xml_tool_calls}")

        # Log model info
        logger.info(f"🤖 Thread {thread_id}: Using model {llm_model}")

        # Ensure processor_config is not None
        config = processor_config or ProcessorConfig()

        # Apply max_xml_tool_calls if specified and not already set in config
        if max_xml_tool_calls > 0 and not config.max_xml_tool_calls:
            config.max_xml_tool_calls = max_xml_tool_calls

        # Create a working copy of the system prompt to potentially modify
        working_system_prompt = system_prompt.copy()

        # Add XML examples to system prompt if requested, do this only ONCE before the loop
        if include_xml_examples and config.xml_tool_calling:
            xml_examples = self.tool_registry.get_xml_examples()
            if xml_examples:
                examples_content = """
--- XML TOOL CALLING ---

In this environment you have access to a set of tools you can use to answer the user's question. The tools are specified in XML format.
Format your tool calls using the specified XML tags. Place parameters marked as 'attribute' within the opening tag (e.g., `<tag attribute='value'>`). Place parameters marked as 'content' between the opening and closing tags. Place parameters marked as 'element' within their own child tags (e.g., `<tag><element>value</element></tag>`). Refer to the examples provided below for the exact structure of each tool.
String and scalar parameters should be specified as attributes, while content goes between tags.
Note that spaces for string values are not stripped. The output is parsed with regular expressions.

Here are the XML tools available with examples:
"""
                for tag_name, example in xml_examples.items():
                    examples_content += f"<{tag_name}> Example: {example}\\n"

                # # Save examples content to a file
                # try:
                #     with open('xml_examples.txt', 'w') as f:
                #         f.write(examples_content)
                #     logger.debug("Saved XML examples to xml_examples.txt")
                # except Exception as e:
                #     logger.error(f"Failed to save XML examples to file: {e}")

                system_content = working_system_prompt.get('content')

                if isinstance(system_content, str):
                    working_system_prompt['content'] += examples_content
                    logger.debug("Appended XML examples to string system prompt content.")
                elif isinstance(system_content, list):
                    appended = False
                    for item in working_system_prompt['content']: # Modify the copy
                        if isinstance(item, dict) and item.get('type') == 'text' and 'text' in item:
                            item['text'] += examples_content
                            logger.debug("Appended XML examples to the first text block in list system prompt content.")
                            appended = True
                            break
                    if not appended:
                        logger.warning("System prompt content is a list but no text block found to append XML examples.")
                else:
                    logger.warning(f"System prompt content is of unexpected type ({type(system_content)}), cannot add XML examples.")
        # Control whether we need to auto-continue due to tool_calls finish reason
        auto_continue = True
        auto_continue_count = 0
        
        # Shared state for continuous streaming across auto-continues
        continuous_state = {
            'accumulated_content': '',
            'thread_run_id': None
        }

        # Define inner function to handle a single run
        async def _run_once(temp_msg=None):
            try:
                # Ensure config is available in this scope
                nonlocal config
                # Note: config is now guaranteed to exist due to check above

                # 1. Get messages from thread for LLM call
                messages = await self.get_llm_messages(thread_id)

                # 2. Check token count before proceeding
                token_count = 0
                try:
                    # Use the potentially modified working_system_prompt for token counting
                    token_count = token_counter(model=llm_model, messages=[working_system_prompt] + messages)
                    token_threshold = self.context_manager.token_threshold
                    logger.info(f"Thread {thread_id} token count: {token_count}/{token_threshold} ({(token_count/token_threshold)*100:.1f}%)")

                except Exception as e:
                    logger.error(f"Error counting tokens or summarizing: {str(e)}")

                # 3. Prepare messages for LLM call + add temporary message if it exists
                # Use the working_system_prompt which may contain the XML examples
                prepared_messages = [working_system_prompt]

                # Find the last user message index
                last_user_index = -1
                for i, msg in enumerate(messages):
                    if msg.get('role') == 'user':
                        last_user_index = i

                # Insert temporary message before the last user message if it exists
                if temp_msg and last_user_index >= 0:
                    prepared_messages.extend(messages[:last_user_index])
                    prepared_messages.append(temp_msg)
                    prepared_messages.extend(messages[last_user_index:])
                    logger.debug("Added temporary message before the last user message")
                else:
                    # If no user message or no temporary message, just add all messages
                    prepared_messages.extend(messages)
                    if temp_msg:
                        prepared_messages.append(temp_msg)
                        logger.debug("Added temporary message to the end of prepared messages")

                # Add partial assistant content for auto-continue context (without saving to DB)
                if auto_continue_count > 0 and continuous_state.get('accumulated_content'):
                    partial_content = continuous_state.get('accumulated_content', '')
                    
                    # Create temporary assistant message with just the text content
                    temporary_assistant_message = {
                        "role": "assistant",
                        "content": partial_content
                    }
                    prepared_messages.append(temporary_assistant_message)
                    logger.info(f"Added temporary assistant message with {len(partial_content)} chars for auto-continue context")

                # 4. Prepare tools for LLM call
                openapi_tool_schemas = None
                if config.native_tool_calling:
                    openapi_tool_schemas = self.tool_registry.get_openapi_schemas()
                    logger.debug(f"Retrieved {len(openapi_tool_schemas) if openapi_tool_schemas else 0} OpenAPI tool schemas")

                # 4.5. Apply context management if enabled
                if enable_context_manager:
                    logger.info(f"Context manager enabled - compressing messages for thread {thread_id}")
                    prepared_messages = self.context_manager.compress_messages(prepared_messages, llm_model)
                else:
                    logger.info(f"Context manager disabled - using uncompressed messages for thread {thread_id}")
                    # Check token count and warn if it's high
                    try:
                        uncompressed_token_count = token_counter(model=llm_model, messages=prepared_messages)
                        token_threshold = self.context_manager.token_threshold
                        logger.info(f"Uncompressed token count: {uncompressed_token_count}")
                        
                        if uncompressed_token_count > token_threshold:
                            logger.warning(f"High token count ({uncompressed_token_count}) exceeds threshold ({token_threshold}) with context manager disabled - this may cause API errors")
                        elif uncompressed_token_count > (token_threshold * 0.8):
                            logger.warning(f"Token count ({uncompressed_token_count}) is approaching threshold ({token_threshold}) - consider enabling context manager")
                    except Exception as e:
                        logger.error(f"Error counting tokens for uncompressed messages: {str(e)}")

                # 5. Make LLM API call
                logger.debug("Making LLM API call")
                try:
                    # OPTIMIZED: Check user plan first to avoid unnecessary BYOK operations
                    account_id = await self._get_account_id_from_thread(thread_id)
                    user_plan = await APIKeyResolver.get_user_plan_cached(account_id)
                    
                    if user_plan == 'byok':
                        # Only call APIKeyResolver for BYOK users
                        api_key, key_source, key_error = await APIKeyResolver.get_openrouter_key_for_user(account_id)
                        
                        if not api_key:
                            error_msg = key_error or "BYOK plan requires OpenRouter API key. Please configure your API key in settings."
                            logger.error(f"BYOK user {account_id} missing API key: {error_msg}")
                            raise Exception(f"API key error: {error_msg}")
                        
                        logger.debug(f"Using BYOK OpenRouter key for user {account_id}")
                    else:
                        # Use cached system key directly for non-BYOK users (major performance optimization)
                        api_key = self._get_system_openrouter_key()
                        key_source = "system"
                        key_error = None
                        
                        if not api_key:
                            error_msg = "System OpenRouter API key not configured"
                            logger.error(f"System OpenRouter API key missing for user {account_id}")
                            raise Exception(f"API key error: {error_msg}")
                        
                        logger.debug(f"Using cached system OpenRouter key for user {account_id} (plan: {user_plan})")
                    
                    # Continue with the resolved API key
                    logger.debug(f"API key resolved - source: {key_source}, user: {account_id}")
                    
                    if generation:
                        generation.update(
                            input=prepared_messages,
                            start_time=datetime.datetime.now(datetime.timezone.utc),
                            model=llm_model,
                            model_parameters={
                              "max_tokens": llm_max_tokens,
                              "temperature": llm_temperature,
                              "enable_thinking": enable_thinking,
                              "reasoning_effort": reasoning_effort,
                              "tool_choice": tool_choice,
                              "tools": openapi_tool_schemas,
                              "api_key_source": key_source,
                            }
                        )
                    llm_response = await make_llm_api_call(
                        prepared_messages, # Pass the potentially modified messages
                        llm_model,
                        temperature=llm_temperature,
                        max_tokens=llm_max_tokens,
                        tools=openapi_tool_schemas,
                        tool_choice=tool_choice if config.native_tool_calling else "none",
                        api_key=api_key,  # Pass the resolved API key
                        stream=stream,
                        enable_thinking=enable_thinking,
                        reasoning_effort=reasoning_effort
                    )
                    
                    # Update key usage tracking
                    await APIKeyResolver.update_key_usage(account_id, key_source)
                    logger.debug("Successfully received raw LLM API response stream/object")

                except Exception as e:
                    logger.error(f"Failed to make LLM API call: {str(e)}", exc_info=True)
                    
                    # 🚀 AUTO-DEACTIVATION: Check for 401 errors with BYOK keys
                    await self._handle_llm_api_error(e, account_id, key_source)
                    
                    raise

                # 6. Process LLM response using the ResponseProcessor
                if stream:
                    logger.debug("Processing streaming response")
                    # Ensure we have an async generator for streaming
                    if hasattr(llm_response, '__aiter__'):
                        response_generator = self.response_processor.process_streaming_response(
                            llm_response=cast(AsyncGenerator, llm_response),
                            thread_id=thread_id,
                            config=config,
                            prompt_messages=prepared_messages,
                            llm_model=llm_model,
                            generation=generation,
                            can_auto_continue=(native_max_auto_continues > 0),
                            auto_continue_count=auto_continue_count,
                            continuous_state=continuous_state,
                        )
                    else:
                        # Fallback to non-streaming if response is not iterable
                        response_generator = self.response_processor.process_non_streaming_response(
                            llm_response=llm_response,
                            thread_id=thread_id,
                            config=config,
                            prompt_messages=prepared_messages,
                            llm_model=llm_model,
                            generation=generation,
                            can_auto_continue=(native_max_auto_continues > 0),
                            auto_continue_count=auto_continue_count,
                            continuous_state=continuous_state,
                        )

                    return response_generator
                else:
                    logger.debug("Processing non-streaming response")
                    # Pass through the response generator without try/except to let errors propagate up
                    response_generator = self.response_processor.process_non_streaming_response(
                        llm_response=llm_response,
                        thread_id=thread_id,
                        config=config,
                        prompt_messages=prepared_messages,
                        llm_model=llm_model,
                        generation=generation,
                        can_auto_continue=(native_max_auto_continues > 0),
                        auto_continue_count=auto_continue_count,
                        continuous_state=continuous_state,
                    )
                    return response_generator # Return the generator

            except Exception as e:
                logger.error(f"Error in run_thread: {str(e)}", exc_info=True)
                # Return the error as a dict to be handled by the caller
                return {
                    "type": "status",
                    "status": "error",
                    "message": str(e)
                }

        # Define a wrapper generator that handles auto-continue logic
        async def auto_continue_wrapper():
            nonlocal auto_continue, auto_continue_count

            while auto_continue and (native_max_auto_continues == 0 or auto_continue_count < native_max_auto_continues):
                # Reset auto_continue for this iteration
                auto_continue = False

                # Run the thread once, passing the potentially modified system prompt
                # Pass temp_msg only on the first iteration
                try:
                    response_gen = await _run_once(temporary_message if auto_continue_count == 0 else None)

                    # Handle error responses
                    if isinstance(response_gen, dict) and "status" in response_gen and response_gen["status"] == "error":
                        logger.error(f"Error in auto_continue_wrapper: {response_gen.get('message', 'Unknown error')}")
                        yield response_gen
                        return  # Exit the generator on error

                    # Process each chunk
                    try:
                        if hasattr(response_gen, '__aiter__'):
                            async for chunk in cast(AsyncGenerator, response_gen):
                                # Check if this is a finish reason chunk with tool_calls or xml_tool_limit_reached
                                if chunk.get('type') == 'finish':
                                    if chunk.get('finish_reason') == 'tool_calls':
                                        # Only auto-continue if enabled (max > 0)
                                        if native_max_auto_continues > 0:
                                            logger.info(f"Detected finish_reason='tool_calls', auto-continuing ({auto_continue_count + 1}/{native_max_auto_continues})")
                                            auto_continue = True
                                            auto_continue_count += 1
                                            # Don't yield the finish chunk to avoid confusing the client
                                            continue
                                    elif chunk.get('finish_reason') == 'xml_tool_limit_reached':
                                        # Don't auto-continue if XML tool limit was reached
                                        logger.info(f"Detected finish_reason='xml_tool_limit_reached', stopping auto-continue")
                                        auto_continue = False
                                        # Still yield the chunk to inform the client
                                
                                # Check for length-based auto-continue in status messages
                                elif chunk.get('type') == 'status':
                                    content = chunk.get('content')
                                    if isinstance(content, dict) and content.get('finish_reason') == 'length':
                                        # Only auto-continue if enabled (max > 0)
                                        if native_max_auto_continues > 0:
                                            logger.info(f"Detected finish_reason='length', auto-continuing ({auto_continue_count + 1}/{native_max_auto_continues})")
                                            auto_continue = True
                                            auto_continue_count += 1
                                            # Don't yield the status chunk to avoid confusing the client
                                            continue

                                # Otherwise just yield the chunk normally
                                yield chunk
                        else:
                            # response_gen is not iterable (likely an error dict), yield it directly
                            yield response_gen

                        # If not auto-continuing, we're done
                        if not auto_continue:
                            break
                    except Exception as e:
                        # If there's an exception, log it, yield an error status, and stop execution
                        logger.error(f"Error in auto_continue_wrapper generator: {str(e)}", exc_info=True)
                        yield {
                            "type": "status",
                            "status": "error",
                            "message": f"Error in thread processing: {str(e)}"
                        }
                        return  # Exit the generator on any error
                except Exception as outer_e:
                    # Catch exceptions from _run_once itself
                    logger.error(f"Error executing thread: {str(outer_e)}", exc_info=True)
                    yield {
                        "type": "status",
                        "status": "error",
                        "message": f"Error executing thread: {str(outer_e)}"
                    }
                    return  # Exit immediately on exception from _run_once

            # If we've reached the max auto-continues, log a warning
            if auto_continue and auto_continue_count >= native_max_auto_continues:
                logger.warning(f"Reached maximum auto-continue limit ({native_max_auto_continues}), stopping.")
                yield {
                    "type": "content",
                    "content": f"\n[Agent reached maximum auto-continue limit of {native_max_auto_continues}]"
                }

        # If auto-continue is disabled (max=0), just run once
        if native_max_auto_continues == 0:
            logger.info("Auto-continue is disabled (native_max_auto_continues=0)")
            # Pass the potentially modified system prompt and temp message
            return await _run_once(temporary_message)

        # Otherwise return the auto-continue wrapper generator
        return auto_continue_wrapper()
    
    def _get_system_openrouter_key(self) -> Optional[str]:
        """Get cached system OpenRouter API key for non-BYOK users"""
        return self._system_openrouter_key
    
    # NOTE: Plan caching has been moved to APIKeyResolver.get_user_plan_cached() for centralized management
    
    async def _get_account_id_from_thread(self, thread_id: str) -> str:
        """Get account_id for a thread"""
        try:
            from services.supabase import DBConnection
            db = DBConnection()
            async with db.get_async_client() as client:
                result = await client.table('threads').select('account_id').eq('thread_id', thread_id).execute()
                if result.data:
                    return result.data[0]['account_id']
                else:
                    raise Exception(f"Thread {thread_id} not found")
        except Exception as e:
            logger.error(f"Error getting account_id for thread {thread_id}: {str(e)}")
            raise
    
    async def _handle_llm_api_error(self, error: Exception, account_id: str, key_source: str) -> None:
        """
        Handle LLM API errors with automatic key deactivation for 401 errors on BYOK keys
        
        Args:
            error: The exception that occurred
            account_id: User's account ID
            key_source: Source of the API key used ("user_byok", "system", "none")
        """
        try:
            from services.llm import LLMError
            from services.user_openrouter_keys import OpenRouterKeyManager
            
            # Check if this is a 401 error for a BYOK key
            if key_source == "user_byok" and isinstance(error, LLMError):
                error_msg = str(error).lower()
                
                # Detect 401/authentication errors
                if any(phrase in error_msg for phrase in [
                    "invalid openrouter api key",
                    "expired session", 
                    "authentication",
                    "unauthorized",
                    "401"
                ]):
                    logger.warning(f"🔒 Detected authentication failure for BYOK user {account_id}")
                    logger.info(f"🛠️  Auto-deactivating invalid OpenRouter API key for user {account_id}")
                    
                    # Auto-deactivate the invalid key
                    success = await OpenRouterKeyManager.set_key_active_status(account_id, False)
                    
                    if success:
                        logger.info(f"✅ Successfully deactivated invalid API key for user {account_id}")
                        
                        # Clear any cached plan data to force fresh lookup
                        await APIKeyResolver.clear_user_plan_cache(account_id)
                        
                        # Update the error message to be more user-friendly
                        error.args = (
                            "Your OpenRouter API key has been automatically deactivated due to authentication failure. "
                            "Please check your API key status in Settings → BYOK and add a valid key to continue.",
                        )
                    else:
                        logger.warning(f"⚠️  Failed to deactivate invalid API key for user {account_id}")
                        
        except Exception as deactivation_error:
            # Don't let deactivation errors interfere with the main error flow
            logger.error(f"Error during automatic key deactivation for user {account_id}: {str(deactivation_error)}")
            # Continue with original error
