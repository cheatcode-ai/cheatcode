from typing import Any, Dict, List, Optional
from agentpress.tool import Tool, ToolResult, openapi_schema, xml_schema, ToolSchema, SchemaType
from composio_integration.client import MCPManager
from utils.logger import logger
import inspect
from .dynamic_tool_builder import DynamicToolBuilder


class MCPToolWrapper(Tool):
    """
    Wrapper for MCP tools that connects via Composio.
    Dynamically creates Python methods for all available MCP tools.
    """

    def __init__(self, mcp_configs: Optional[List[Dict[str, Any]]] = None):
        self.mcp_manager = MCPManager()
        self.mcp_configs = mcp_configs or []
        self._initialized = False
        self._schemas: Dict[str, List[ToolSchema]] = {}
        self._dynamic_tools = {}

        self.tool_builder = DynamicToolBuilder()

        super().__init__()

    async def _ensure_initialized(self):
        if not self._initialized:
            await self._initialize_servers()
            await self._create_dynamic_tools()
            self._initialized = True

    async def _initialize_servers(self):
        """Initialize connections to MCP servers via Composio."""
        for config in self.mcp_configs:
            try:
                logger.info(f"Attempting to connect to MCP server: {config['qualifiedName']}")
                external_user_id = config.get('config', {}).get('external_user_id')
                await self.mcp_manager.connect_server(config, external_user_id)
                logger.info(f"Successfully connected to MCP server: {config['qualifiedName']}")
            except Exception as e:
                logger.error(f"Failed to connect to MCP server {config['qualifiedName']}: {e}")

    async def _create_dynamic_tools(self):
        """Create Python methods for all available MCP tools."""
        try:
            available_tools = self.mcp_manager.get_all_tools_openapi()
            logger.info(f"MCPManager returned {len(available_tools)} tools")

            dynamic_methods = self.tool_builder.create_dynamic_methods(
                available_tools,
                {},  # No custom tools
                self._execute_mcp_tool
            )

            self._dynamic_tools = self.tool_builder.get_dynamic_tools()

            for method_name, method in dynamic_methods.items():
                setattr(self, method_name, method)

            self._schemas.update(self.tool_builder.get_schemas())

            logger.info(f"Created {len(self._dynamic_tools)} dynamic MCP tool methods")

        except Exception as e:
            logger.error(f"Error creating dynamic MCP tools: {e}")

    def _register_schemas(self):
        for name, method in inspect.getmembers(self, predicate=inspect.ismethod):
            if hasattr(method, 'tool_schemas'):
                self._schemas[name] = method.tool_schemas
                logger.debug(f"Registered schemas for method '{name}' in {self.__class__.__name__}")

        logger.debug(f"Initial registration complete for MCPToolWrapper")

    def get_schemas(self) -> Dict[str, List[ToolSchema]]:
        return self._schemas

    def __getattr__(self, name: str):
        method = self.tool_builder.find_method_by_name(name)
        if method:
            return method

        for tool_data in self._dynamic_tools.values():
            if tool_data.get('method_name') == name:
                return tool_data.get('method')

        name_with_hyphens = name.replace('_', '-')
        for tool_name, tool_data in self._dynamic_tools.items():
            if tool_data.get('method_name') == name or tool_name == name_with_hyphens:
                return tool_data.get('method')

        raise AttributeError(f"'{self.__class__.__name__}' object has no attribute '{name}'")

    async def initialize_and_register_tools(self, tool_registry=None):
        await self._ensure_initialized()
        if tool_registry and self._dynamic_tools:
            logger.info(f"Updating tool registry with {len(self._dynamic_tools)} MCP tools")
            for method_name, schemas in self._schemas.items():
                if method_name not in ['call_mcp_tool']:
                    pass

    async def get_available_tools(self) -> List[Dict[str, Any]]:
        await self._ensure_initialized()
        return self.mcp_manager.get_all_tools_openapi()

    async def _execute_mcp_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        """Execute an MCP tool via Composio."""
        await self._ensure_initialized()

        logger.info(f"Executing MCP tool {tool_name} with arguments {arguments}")

        try:
            result = await self.mcp_manager.execute_tool(tool_name, arguments)

            if isinstance(result, dict):
                if result.get('isError', False):
                    return self.fail_response(result.get('content', 'Tool execution failed'))
                else:
                    return self.success_response(result.get('content', result))
            else:
                return self.success_response(result)

        except Exception as e:
            logger.error(f"Error executing MCP tool {tool_name}: {str(e)}")
            return self.fail_response(f"Error executing tool: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "call_mcp_tool",
            "description": "Execute a tool from any connected MCP server. This is a fallback wrapper that forwards calls to MCP tools. The tool_name should be in the format 'mcp_{server}_{tool}' where {server} is the MCP server's qualified name and {tool} is the specific tool name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tool_name": {
                        "type": "string",
                        "description": "The full MCP tool name in format 'mcp_{server}_{tool}', e.g., 'mcp_exa_web_search_exa'"
                    },
                    "arguments": {
                        "type": "object",
                        "description": "The arguments to pass to the MCP tool, as a JSON object. The required arguments depend on the specific tool being called.",
                        "additionalProperties": True
                    }
                },
                "required": ["tool_name", "arguments"]
            }
        }
    })
    @xml_schema(
        tag_name="call-mcp-tool",
        mappings=[
            {"param_name": "tool_name", "node_type": "attribute", "path": "."},
            {"param_name": "arguments", "node_type": "content", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="call_mcp_tool">
        <parameter name="tool_name">mcp_exa_web_search_exa</parameter>
        <parameter name="arguments">{"query": "latest developments in AI", "num_results": 10}</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def call_mcp_tool(self, tool_name: str, arguments: Dict[str, Any]) -> ToolResult:
        return await self._execute_mcp_tool(tool_name, arguments)

    async def cleanup(self):
        if self._initialized:
            try:
                await self.mcp_manager.disconnect_all()
            except Exception as e:
                logger.error(f"Error during MCP cleanup: {str(e)}")
            finally:
                self._initialized = False
