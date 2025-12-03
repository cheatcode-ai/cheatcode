from typing import List, Dict, Any, Optional, Tuple
from agentpress.tool import ToolResult, ToolSchema, SchemaType, XMLTagSchema, XMLNodeMapping
from sandbox.tool_base import SandboxToolsBase    
from utils.files_utils import should_exclude_file, clean_path
from agentpress.thread_manager import ThreadManager
from utils.logger import logger
from utils.config import config
import os
import json
import re
import litellm
import openai

class SandboxFilesTool(SandboxToolsBase):
    """Tool for executing file system operations in a Daytona sandbox. All operations are performed relative to the workspace directory."""

    def __init__(self, project_id: str, thread_manager: ThreadManager, app_type: str = 'web'):
        super().__init__(project_id, thread_manager, app_type)
        self.SNIPPET_LINES = 4  # Number of context lines to show around edits
        # workspace_path is inherited from base class and points to the correct workspace directory

    def get_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Override base class to provide dynamic schemas based on app_type."""
        return self.get_tool_schemas()
    
    def get_tool_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Generate dynamic tool schemas based on app_type context."""
        
        # Determine context-appropriate examples and descriptions
        if self.app_type == 'mobile':
            # Expo React Native examples
            create_example = "app/index.tsx"
            create_description = "Path to the file to be created, relative to the workspace root (e.g., 'components/ui/my-component.tsx', 'lib/utils.ts')"
            read_example = "components/ui/button.tsx"
            read_description = "Path to the file to read, relative to the workspace root (e.g., 'app/index.tsx', 'components/ui/avatar.tsx')"
            list_example = "components/ui"
            list_description = "Directory path relative to workspace root to list (e.g., 'app', 'components', 'lib')"
            delete_example = "components/ui/unused-component.tsx"
            delete_description = "Path to the file to delete, relative to the workspace root (e.g., 'components/ui/old-component.tsx')"
            edit_example = "app/index.tsx"
            edit_description = "Path to the file to edit, relative to the workspace root (e.g., 'app/index.tsx', 'components/ui/button.tsx')"
            xml_create_example = "components/ui/my-component.tsx"
            xml_read_example = "app/index.tsx"
        else:
            # React/Next.js examples  
            create_example = "src/app/page.tsx"
            create_description = "Path to the file to be created, relative to the workspace root (e.g., 'src/components/ui/button.tsx', 'src/lib/utils.ts')"
            read_example = "src/components/ui/button.tsx"
            read_description = "Path to the file to read, relative to the workspace root (e.g., 'src/app/page.tsx', 'src/components/blocks/header.tsx')"
            list_example = "src/components"
            list_description = "Directory path relative to workspace root to list (e.g., 'src', 'components', 'lib')"
            delete_example = "src/components/ui/unused-component.tsx"
            delete_description = "Path to the file to delete, relative to the workspace root (e.g., 'src/components/ui/old-button.tsx')"
            edit_example = "src/app/page.tsx"
            edit_description = "Path to the file to edit, relative to the workspace root (e.g., 'src/app/page.tsx', 'src/components/blocks/header.tsx')"
            xml_create_example = "src/components/ui/button.tsx"
            xml_read_example = "src/app/page.tsx"

        schemas = {}
        
        # create_file schema
        schemas["create_file"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "create_file",
                        "description": "Create a new file with the provided contents at a given path in the workspace. The path must be relative to the workspace root.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "file_path": {
                                    "type": "string",
                                    "description": create_description
                                },
                                "file_contents": {
                                    "type": "string",
                                    "description": "The content to write to the file"
                                },
                                "permissions": {
                                    "type": "string",
                                    "description": "File permissions in octal format (e.g., '644')",
                                    "default": "644"
                                }
                            },
                            "required": ["file_path", "file_contents"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="create-file",
                    mappings=[
                        XMLNodeMapping(param_name="file_path", node_type="attribute", path="."),
                        XMLNodeMapping(param_name="file_contents", node_type="content", path=".")
                    ],
                    example=f'''
        <function_calls>
        <invoke name="create_file">
        <parameter name="file_path">{xml_create_example}</parameter>
        <parameter name="file_contents">export default function MyComponent() {{
  return <div>Hello World</div>;
}}</parameter>
        </invoke>
        </function_calls>'''
                )
            )
        ]

        # read_file schema
        schemas["read_file"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "read_file",
                        "description": "Read the contents of a file from the workspace directory. Use start_line and end_line to read specific sections.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "file_path": {
                                    "type": "string",
                                    "description": read_description
                                },
                                "start_line": {
                                    "type": "integer",
                                    "description": "Starting line number (1-based indexing)",
                                    "default": 1
                                },
                                "end_line": {
                                    "type": "integer",
                                    "description": "Ending line number (inclusive). If not provided, reads to end of file"
                                }
                            },
                            "required": ["file_path"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="read-file",
                    mappings=[
                        XMLNodeMapping(param_name="file_path", node_type="attribute", path="."),
                        XMLNodeMapping(param_name="start_line", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="end_line", node_type="attribute", path=".", required=False)
                    ],
                    example=f'''
        <function_calls>
        <invoke name="read_file">
        <parameter name="file_path">{xml_read_example}</parameter>
        </invoke>
        </function_calls>'''
                )
            )
        ]

        # write_file schema
        schemas["write_file"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "write_file",
                        "description": "Create or overwrite a file with new content. If the file exists, replaces its contents; if not, creates a new file.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "file_path": {
                                    "type": "string",
                                    "description": edit_description
                                },
                                "file_contents": {
                                    "type": "string",
                                    "description": "The content to write to the file"
                                },
                                "permissions": {
                                    "type": "string",
                                    "description": "File permissions in octal format (e.g., '644')",
                                    "default": "644"
                                }
                            },
                            "required": ["file_path", "file_contents"]
                        }
                    }
                }
            )
        ]

        # full_file_rewrite schema
        schemas["full_file_rewrite"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "full_file_rewrite",
                        "description": "Completely rewrite an existing file with new content. The file must already exist.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "file_path": {
                                    "type": "string",
                                    "description": edit_description
                                },
                                "file_contents": {
                                    "type": "string",
                                    "description": "The new content to replace the entire file"
                                },
                                "permissions": {
                                    "type": "string",
                                    "description": "File permissions in octal format (e.g., '644')",
                                    "default": "644"
                                }
                            },
                            "required": ["file_path", "file_contents"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="full-file-rewrite",
                    mappings=[
                        XMLNodeMapping(param_name="file_path", node_type="attribute", path="."),
                        XMLNodeMapping(param_name="file_contents", node_type="content", path=".")
                    ],
                    example=f'''
        <function_calls>
        <invoke name="full_file_rewrite">
        <parameter name="file_path">{xml_create_example}</parameter>
        <parameter name="file_contents">// Complete new file content
export default function UpdatedComponent() {{
  return <div>This replaces all existing content</div>;
}}</parameter>
        </invoke>
        </function_calls>'''
                )
            )
        ]

        # delete_file schema
        schemas["delete_file"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "delete_file",
                        "description": "Delete a file from the workspace directory.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "file_path": {
                                    "type": "string",
                                    "description": delete_description
                                }
                            },
                            "required": ["file_path"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="delete-file",
                    mappings=[
                        XMLNodeMapping(param_name="file_path", node_type="attribute", path=".")
                    ],
                    example=f'''
        <function_calls>
        <invoke name="delete_file">
        <parameter name="file_path">{delete_example}</parameter>
        </invoke>
        </function_calls>'''
                )
            )
        ]

        # list_files schema
        schemas["list_files"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "list_files",
                        "description": "List files and directories in the workspace directory.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": list_description,
                                    "default": ""
                                },
                                "recursive": {
                                    "type": "boolean",
                                    "description": "Whether to list files recursively in subdirectories",
                                    "default": False
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
                    tag_name="list-files",
                    mappings=[
                        XMLNodeMapping(param_name="path", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="recursive", node_type="attribute", path=".", required=False)
                    ],
                    example=f'''
        <function_calls>
        <invoke name="list_files">
        <parameter name="path">{list_example}</parameter>
        </invoke>
        </function_calls>'''
                )
            )
        ]

        # edit_file schema
        schemas["edit_file"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "edit_file",
                        "description": "Edit an existing file using AI-powered code transformation. Provide clear instructions for the changes needed.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "target_file": {
                                    "type": "string",
                                    "description": edit_description
                                },
                                "instructions": {
                                    "type": "string",
                                    "description": "Clear instructions describing what changes to make to the file"
                                },
                                "code_edit": {
                                    "type": "string",
                                    "description": "Specific code snippet or example showing the desired changes"
                                }
                            },
                            "required": ["target_file", "instructions", "code_edit"]
                        }
                    }
                }
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="edit-file",
                    mappings=[
                        XMLNodeMapping(param_name="target_file", node_type="attribute", path="."),
                        XMLNodeMapping(param_name="instructions", node_type="element", path="instructions"),
                        XMLNodeMapping(param_name="code_edit", node_type="element", path="code_edit")
                    ],
                    example=f'''
        <function_calls>
        <invoke name="edit_file">
        <parameter name="target_file">{edit_example}</parameter>
        <parameter name="instructions">Add a new useState hook for managing the counter state</parameter>
        <parameter name="code_edit">const [count, setCount] = useState(0);</parameter>
        </invoke>
        </function_calls>'''
                )
            )
        ]

        return schemas

    def clean_path(self, path: str) -> str:
        """Clean and normalize a path to be relative to the workspace"""
        return clean_path(path, self.workspace_path)

    def _should_exclude_file(self, rel_path: str) -> bool:
        """Check if a file should be excluded based on path, name, or extension"""
        return should_exclude_file(rel_path)

    def _is_react_nextjs_key_file(self, file_path: str) -> bool:
        """Check if this is a key React/Next.js file that warrants development guidance"""
        file_path = file_path.lower()
        key_files = [
            'package.json',
            'next.config.js',
            'next.config.ts', 
            'next.config.mjs',
            'src/app.jsx',
            'src/app.tsx',
            'src/app/page.tsx',
            'src/app/page.jsx',
            'app/page.tsx',
            'app/page.jsx',
            'pages/index.tsx',
            'pages/index.jsx',
            'pages/_app.tsx',
            'pages/_app.jsx'
        ]
        return any(file_path.endswith(key_file) or file_path == key_file for key_file in key_files)

    async def _get_react_dev_guidance(self, file_path: str) -> str:
        """Generate helpful development guidance for React/Next.js files"""
        file_path = file_path.lower()
        
        try:
            # Dynamic port and commands based on app_type
            port = 8081 if self.app_type == 'mobile' else 3000
            dev_command = "npx expo start" if self.app_type == 'mobile' else "npm run dev"
            app_type_name = "Expo React Native" if self.app_type == 'mobile' else "React/Next.js"
            
            if 'package.json' in file_path or (self.app_type == 'mobile' and any(x in file_path for x in ['app.json', 'expo.json'])):
                return (f"[{app_type_name} Project Detected]\n"
                       "💡 To start development:\n"
                       f"   1. Run: {dev_command}\n"
                       f"   2. Use expose_port tool on port {port} to access your app")
            
            elif 'next.config' in file_path and self.app_type != 'mobile':
                return ("[Next.js Configuration Updated]\n"
                       "💡 Restart your dev server if running:\n"
                       "   • Stop: Ctrl+C in terminal\n"
                       f"   • Start: {dev_command}\n"
                       f"   • Expose: Use expose_port tool on port {port}")
            
            elif (self.app_type == 'mobile' and any(pattern in file_path for pattern in ['app.json', 'expo.json'])) or \
                 (self.app_type != 'mobile' and any(pattern in file_path for pattern in ['app/page.', 'src/app.', 'pages/index.', 'pages/_app.'])):
                # Try to get preview link if dev server might be running
                try:
                    website_link = await self.sandbox.get_preview_link(port)
                    website_url = website_link.url if hasattr(website_link, 'url') else str(website_link).split("url='")[1].split("'")[0]
                    return (f"[{app_type_name} Component Updated]\n"
                           f"🚀 Your app should be available at: {website_url}\n"
                           f"💡 If not running: {dev_command}, then use expose_port on port {port}")
                except Exception:
                    return (f"[{app_type_name} Component Updated]\n"
                           "💡 To see changes:\n"
                           f"   • Start dev server: {dev_command}\n"
                           f"   • Expose port {port} for preview\n"
                           "   • Changes will hot-reload automatically")
            
            return ""
            
        except Exception as e:
            logger.warning(f"Failed to generate React dev guidance: {str(e)}")
            return ""

    async def _file_exists(self, path: str) -> bool:
        """Check if a file exists in the sandbox"""
        try:
            await self.sandbox.fs.get_file_info(path)
            return True
        except Exception:
            return False

    async def get_workspace_state(self) -> dict:
        """Get the current workspace state by reading all files"""
        files_state = {}
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()
            
            files = await self.sandbox.fs.list_files(self.workspace_path)
            for file_info in files:
                rel_path = file_info.name
                
                # Skip excluded files and directories
                if self._should_exclude_file(rel_path) or file_info.is_dir:
                    continue

                try:
                    full_path = f"{self.workspace_path}/{rel_path}"
                    content = (await self.sandbox.fs.download_file(full_path)).decode()
                    files_state[rel_path] = {
                        "content": content,
                        "is_dir": file_info.is_dir,
                        "size": file_info.size,
                        "modified": file_info.mod_time
                    }
                except Exception as e:
                    print(f"Error reading file {rel_path}: {e}")
                except UnicodeDecodeError:
                    print(f"Skipping binary file: {rel_path}")

            return files_state
        
        except Exception as e:
            print(f"Error getting workspace state: {str(e)}")
            return {}


    # def _get_preview_url(self, file_path: str) -> Optional[str]:
    #     """Get the preview URL for a file if it's an HTML file."""

    #     return None

    async def create_file(self, file_path: str, file_contents: str, permissions: str = "644") -> ToolResult:
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()
            
            file_path = self.clean_path(file_path)
            full_path = f"{self.workspace_path}/{file_path}"
            if await self._file_exists(full_path):
                return self.fail_response(f"File '{file_path}' already exists. Use update_file to modify existing files.")
            
            # Create parent directories if needed
            parent_dir = '/'.join(full_path.split('/')[:-1])
            if parent_dir:
                await self.sandbox.fs.create_folder(parent_dir, "755")
            
            # convert to json string if file_contents is a dict
            if isinstance(file_contents, dict):
                file_contents = json.dumps(file_contents, indent=4)
            
            # Write the file content
            await self.sandbox.fs.upload_file(file_contents.encode(), full_path)
            await self.sandbox.fs.set_file_permissions(full_path, permissions)
            
            message = f"File '{file_path}' created successfully."
            
            # Check for React/Next.js key files and provide development guidance
            if self._is_react_nextjs_key_file(file_path):
                dev_guidance = await self._get_react_dev_guidance(file_path)
                if dev_guidance:
                    message += f"\n\n{dev_guidance}"
            
            return self.success_response(message)
        except Exception as e:
            return self.fail_response(f"Error creating file: {str(e)}")

    async def full_file_rewrite(self, file_path: str, file_contents: str, permissions: str = "644") -> ToolResult:
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()
            
            file_path = self.clean_path(file_path)
            full_path = f"{self.workspace_path}/{file_path}"
            if not await self._file_exists(full_path):
                return self.fail_response(f"File '{file_path}' does not exist. Use create_file to create a new file.")
            
            await self.sandbox.fs.upload_file(file_contents.encode(), full_path)
            await self.sandbox.fs.set_file_permissions(full_path, permissions)
            
            message = f"File '{file_path}' completely rewritten successfully."
            
            # Check for React/Next.js key files and provide development guidance
            if self._is_react_nextjs_key_file(file_path):
                dev_guidance = await self._get_react_dev_guidance(file_path)
                if dev_guidance:
                    message += f"\n\n{dev_guidance}"
            
            return self.success_response(message)
        except Exception as e:
            return self.fail_response(f"Error rewriting file: {str(e)}")

    async def write_file(self, file_path: str, file_contents: str, permissions: str = "644") -> ToolResult:
        """Create or overwrite a file with the given contents.

        This helper combines create_file / full_file_rewrite so callers don't have to
        check whether the file already exists. If the file is present we perform a
        full rewrite, otherwise we create it first.
        """
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()

            file_path = self.clean_path(file_path)
            full_path = f"{self.workspace_path}/{file_path}"

            # Choose create vs rewrite based on existence
            if await self._file_exists(full_path):
                return await self.full_file_rewrite(file_path, file_contents, permissions)
            else:
                return await self.create_file(file_path, file_contents, permissions)
        except Exception as e:
            return self.fail_response(f"Error writing file: {str(e)}")

    async def delete_file(self, file_path: str) -> ToolResult:
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()
            
            file_path = self.clean_path(file_path)
            full_path = f"{self.workspace_path}/{file_path}"
            if not await self._file_exists(full_path):
                return self.fail_response(f"File '{file_path}' does not exist")
            
            await self.sandbox.fs.delete_file(full_path)
            return self.success_response(f"File '{file_path}' deleted successfully.")
        except Exception as e:
            return self.fail_response(f"Error deleting file: {str(e)}")

    async def list_files(self, path: str = "", recursive: bool = False) -> ToolResult:
        """List files and directories in the specified path"""
        try:
            await self._ensure_sandbox()
            
            # Clean the path and make it relative to workspace
            path = self.clean_path(path)
            full_path = f"{self.workspace_path}/{path}" if path else self.workspace_path
            
            # Check if directory exists
            try:
                await self.sandbox.fs.get_file_info(full_path)
            except Exception:
                return self.fail_response(f"Directory '{path}' does not exist")
            
            async def walk_directory(dir_full: str, rel_dir: str):
                """Recursively walk directory returning list of file info dicts."""
                entries = await self.sandbox.fs.list_files(dir_full)
                collected = []
                for entry in entries:
                    rel_path = f"{rel_dir}/{entry.name}" if rel_dir else entry.name
                    info = {
                        "name": rel_path,
                        "type": "directory" if entry.is_dir else "file",
                        "size": entry.size if not entry.is_dir else None,
                        "modified": str(entry.mod_time) if hasattr(entry, 'mod_time') else None
                    }
                    collected.append(info)
                    if recursive and entry.is_dir:
                        sub_full = f"{dir_full}/{entry.name}"
                        collected.extend(await walk_directory(sub_full, rel_path))
                return collected

            file_list = await walk_directory(full_path, "")
            # Sort directories before files at each level already handled by recursion order; ensure consistent global sort
            file_list.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))
            
            result = {
                "message": f"Found {len(file_list)} items in '{path or '.'}'",
                "path": path or ".",
                "files": file_list,
                "total_count": len(file_list)
            }
            
            return self.success_response(result)
            
        except Exception as e:
            return self.fail_response(f"Error listing directory: {str(e)}")

    async def read_file(self, file_path: str, start_line: int = 1, end_line: int = None) -> ToolResult:
        """Read and return the contents of a file inside the sandbox.

        Only the small subset of functionality required by TemplateEditorTool is
        implemented: the entire file is always returned as a single string in the
        `content` field of the result.  Line–range support can be added later if
        needed.
        """
        try:
            await self._ensure_sandbox()

            file_path = self.clean_path(file_path)
            full_path = f"{self.workspace_path}/{file_path}"
            if not await self._file_exists(full_path):
                return self.fail_response(f"File '{file_path}' does not exist")

            # Fetch file bytes and decode assuming UTF-8
            raw_bytes = await self.sandbox.fs.download_file(full_path)
            content = raw_bytes.decode()

            return self.success_response({
                "file_path": file_path,
                "content": content,
            })
        except UnicodeDecodeError:
            return self.fail_response("Unable to decode file as UTF-8 text")
        except Exception as e:
            return self.fail_response(f"Error reading file: {str(e)}")

    async def _call_relace_api(self, file_content: str, code_edit: str, instructions: str, file_path: str) -> Tuple[Optional[str], Optional[str]]:
        """
        Call Relace API to apply edits to file content.
        Returns a tuple (new_content, error_message).
        On success, error_message is None.
        On failure, new_content is None.
        """
        import httpx

        try:
            relace_api_key = getattr(config, 'RELACE_API_KEY', None) or os.getenv('RELACE_API_KEY')

            if not relace_api_key:
                return None, "RELACE_API_KEY not configured"

            # Use Direct REST API (more explicit response format)
            url = "https://instantapply.endpoint.relace.run/v1/code/apply"

            headers = {
                "Authorization": f"Bearer {relace_api_key}",
                "Content-Type": "application/json"
            }

            payload = {
                "initial_code": file_content,
                "edit_snippet": code_edit,
                "instruction": instructions,
                "model": "auto",  # Routes to relace-apply-3
                "stream": False,
                "relace_metadata": {
                    "file_path": file_path,
                    "source": "cheatcode-agent"
                }
            }

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, headers=headers, json=payload)

                if response.status_code == 200:
                    result = response.json()
                    merged_code = result.get("mergedCode")
                    usage = result.get("usage", {})

                    logger.info(f"Relace API success - tokens: {usage.get('total_tokens', 'N/A')}")

                    if merged_code:
                        return merged_code, None
                    else:
                        return None, "Relace API returned empty mergedCode"

                elif response.status_code == 429:
                    return None, "Rate limit exceeded. Please wait and retry."

                elif response.status_code == 413:
                    return None, f"File too large for Relace API (max 50MB). File: {file_path}"

                elif response.status_code in [401, 403]:
                    return None, "Invalid or missing Relace API key"

                else:
                    error_body = response.text
                    return None, f"Relace API error ({response.status_code}): {error_body[:500]}"

        except httpx.TimeoutException:
            return None, f"Relace API timeout after 60s for file: {file_path}"

        except Exception as e:
            error_message = f"Relace API call failed: {str(e)}"
            logger.error(error_message, exc_info=True)
            return None, error_message

    async def edit_file(self, target_file: str, instructions: str, code_edit: str) -> ToolResult:
        """Edit a file using AI-powered intelligent editing"""
        try:
            # Ensure sandbox is initialized
            await self._ensure_sandbox()
            
            target_file = self.clean_path(target_file)
            full_path = f"{self.workspace_path}/{target_file}"
            if not await self._file_exists(full_path):
                return self.fail_response(f"File '{target_file}' does not exist")
            
            # Read current content
            original_content = (await self.sandbox.fs.download_file(full_path)).decode()
            
            # Use Relace fast-apply for intelligent code editing
            logger.info(f"Attempting Relace fast-apply edit for file '{target_file}' with instructions: {instructions[:100]}...")
            new_content, error_message = await self._call_relace_api(original_content, code_edit, instructions, target_file)

            if error_message:
                return self.fail_response(f"AI editing failed: {error_message}")

            if new_content is None:
                return self.fail_response("AI editing failed for an unknown reason. The model returned no content.")

            if new_content == original_content:
                return self.success_response(f"AI editing resulted in no changes to the file '{target_file}'.")

            # AI editing successful
            await self.sandbox.fs.upload_file(new_content.encode(), full_path)
            
            return self.success_response(f"File '{target_file}' edited successfully using AI.")
                    
        except Exception as e:
            logger.error(f"Unhandled error in edit_file: {str(e)}", exc_info=True)
            return self.fail_response(f"Error editing file: {str(e)}")


