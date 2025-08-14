from agentpress.tool import Tool, ToolResult, ToolSchema, SchemaType, XMLTagSchema, XMLNodeMapping
from agentpress.thread_manager import ThreadManager
from typing import Dict, List

class CompletionTool(Tool):
    """Tool for signaling task completion."""

    def __init__(self, thread_manager: ThreadManager, app_type: str = 'web'):
        super().__init__()
        self.thread_manager = thread_manager
        self.app_type = app_type

    def get_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Override base class to provide dynamic schemas based on app_type."""
        return self.get_tool_schemas()
    
    def get_tool_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Generate dynamic tool schemas based on app_type context."""
        
        # Determine context-appropriate examples and descriptions
        if self.app_type == 'mobile':
            # Mobile React Native examples
            completion_example = "Successfully built the mobile fitness tracker app with navigation tabs"
            description_context = "Signal that the current mobile app task has been completed successfully. Use this when all requested Expo/React Native work is finished and the app is ready for preview."
        else:
            # Web React examples
            completion_example = "Successfully built and deployed the fitness app landing page"
            description_context = "Signal that the current web app task has been completed successfully. Use this when all requested Next.js/React work is finished and a preview URL has been provided."

        schemas = {}

        # complete schema
        schemas["complete"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "complete",
                        "description": description_context,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "message": {
                                    "type": "string",
                                    "description": "Optional completion message summarizing what was accomplished",
                                    "default": "Task completed successfully"
                                }
                            },
                            "required": []
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="complete",
                    mappings=[
                        XMLNodeMapping(param_name="message", node_type="content", path=".", required=False)
                    ],
                    example=f'''
<function_calls>
<invoke name="complete">
<parameter name="message">{completion_example}</parameter>
</invoke>
</function_calls>
'''
                )
            )
        ]

        return schemas


    async def complete(self, message: str = "Task completed successfully") -> ToolResult:
        """Signal task completion."""
        return ToolResult(
            success=True,
            output=f"Task completion signaled: {message}"
        ) 