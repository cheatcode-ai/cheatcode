"""
Sandbox LSP Tool - Language Server Protocol integration for Daytona sandboxes.

This tool provides code intelligence features like completions, symbols, and diagnostics
using the Daytona SDK's built-in LSP support.
"""

from typing import Optional, Dict, Any, List
from agentpress.tool import ToolResult, ToolSchema, SchemaType
from sandbox.tool_base import SandboxToolsBase
from agentpress.thread_manager import ThreadManager
from utils.logger import logger


class SandboxLSPTool(SandboxToolsBase):
    """Tool for Language Server Protocol operations in Daytona sandbox.

    Provides code intelligence features like completions, document symbols,
    and workspace-wide symbol search using the Daytona SDK's native LSP support.
    """

    def __init__(self, project_id: str, thread_manager: ThreadManager, app_type: str = 'web'):
        super().__init__(project_id, thread_manager, app_type)
        self._lsp_servers: Dict[str, Any] = {}

    def get_schemas(self) -> Dict[str, List[ToolSchema]]:
        """Return tool schemas for LSP operations."""
        schemas = {}

        # get_completions schema
        schemas["get_completions"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "get_completions",
                        "description": "Get code completions at a specific position in a file. Useful for understanding what methods/properties are available.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "file_path": {
                                    "type": "string",
                                    "description": "Path to the file relative to workspace root"
                                },
                                "line": {
                                    "type": "integer",
                                    "description": "Zero-based line number"
                                },
                                "character": {
                                    "type": "integer",
                                    "description": "Zero-based character position on the line"
                                }
                            },
                            "required": ["file_path", "line", "character"]
                        }
                    }
                }
            )
        ]

        # get_document_symbols schema
        schemas["get_document_symbols"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "get_document_symbols",
                        "description": "Get all symbols (functions, classes, variables, etc.) defined in a document. Useful for understanding file structure.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "file_path": {
                                    "type": "string",
                                    "description": "Path to the file relative to workspace root"
                                }
                            },
                            "required": ["file_path"]
                        }
                    }
                }
            )
        ]

        # search_workspace_symbols schema
        schemas["search_workspace_symbols"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "search_workspace_symbols",
                        "description": "Search for symbols across the entire workspace by name. Useful for finding functions, classes, or variables anywhere in the project.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": "Search query (partial symbol name to search for)"
                                }
                            },
                            "required": ["query"]
                        }
                    }
                }
            )
        ]

        return schemas

    def _get_language_from_extension(self, file_path: str) -> str:
        """Determine the LSP language ID from file extension."""
        ext = file_path.split('.')[-1].lower() if '.' in file_path else ''

        language_map = {
            # TypeScript/JavaScript
            'ts': 'typescript',
            'tsx': 'typescript',
            'js': 'typescript',  # Use TS server for JS too
            'jsx': 'typescript',
            'mjs': 'typescript',
            'cjs': 'typescript',
            # Python
            'py': 'python',
            'pyw': 'python',
            # Others that could be added later
            'go': 'go',
            'rs': 'rust',
            'java': 'java',
            'rb': 'ruby',
            'php': 'php',
        }

        return language_map.get(ext, 'typescript')  # Default to typescript

    async def _ensure_lsp_server(self, language: str) -> Any:
        """Ensure LSP server is started for the given language."""
        if language in self._lsp_servers:
            return self._lsp_servers[language]

        await self._ensure_sandbox()

        try:
            logger.info(f"Creating LSP server for language: {language}")
            lsp = self.sandbox.create_lsp_server(language, self.workspace_path)
            await lsp.start()
            self._lsp_servers[language] = lsp
            logger.info(f"LSP server started for {language}")
            return lsp
        except Exception as e:
            logger.error(f"Failed to start LSP server for {language}: {e}")
            raise

    async def get_completions(
        self,
        file_path: str,
        line: int,
        character: int
    ) -> ToolResult:
        """Get code completions at a specific position.

        Args:
            file_path: Path to file relative to workspace
            line: Zero-based line number
            character: Zero-based character position

        Returns:
            ToolResult with completion items
        """
        try:
            await self._ensure_sandbox()

            # Determine language from file extension
            language = self._get_language_from_extension(file_path)
            lsp = await self._ensure_lsp_server(language)

            # Build full path
            clean_path = self.clean_path(file_path)
            full_path = f"{self.workspace_path}/{clean_path}"

            # Open document in LSP
            try:
                await lsp.did_open(full_path)
            except Exception as open_error:
                logger.debug(f"Document may already be open: {open_error}")

            # Get completions
            completions = await lsp.completions(full_path, {"line": line, "character": character})

            items = []
            for item in (completions.items or [])[:30]:  # Limit to 30 items
                items.append({
                    "label": item.label,
                    "kind": str(item.kind) if hasattr(item, 'kind') else None,
                    "detail": getattr(item, 'detail', None) or "",
                    "documentation": getattr(item, 'documentation', None) or "",
                })

            return self.success_response({
                "file": file_path,
                "position": {"line": line, "character": character},
                "completions": items,
                "count": len(items),
                "is_incomplete": getattr(completions, 'is_incomplete', False)
            })

        except Exception as e:
            logger.error(f"Failed to get completions for {file_path}: {e}")
            return self.fail_response(f"Failed to get completions: {str(e)}")

    async def get_document_symbols(self, file_path: str) -> ToolResult:
        """Get all symbols defined in a document.

        Args:
            file_path: Path to file relative to workspace

        Returns:
            ToolResult with document symbols
        """
        try:
            await self._ensure_sandbox()

            language = self._get_language_from_extension(file_path)
            lsp = await self._ensure_lsp_server(language)

            clean_path = self.clean_path(file_path)
            full_path = f"{self.workspace_path}/{clean_path}"

            # Open document in LSP
            try:
                await lsp.did_open(full_path)
            except Exception as open_error:
                logger.debug(f"Document may already be open: {open_error}")

            # Get symbols
            symbols = await lsp.document_symbols(full_path)

            symbol_list = []
            for symbol in symbols:
                symbol_info = {
                    "name": symbol.name,
                    "kind": str(symbol.kind) if hasattr(symbol, 'kind') else "unknown",
                }

                # Add range if available
                if hasattr(symbol, 'range') and symbol.range:
                    symbol_info["range"] = {
                        "start": {
                            "line": symbol.range.start.line,
                            "character": symbol.range.start.character
                        },
                        "end": {
                            "line": symbol.range.end.line,
                            "character": symbol.range.end.character
                        }
                    }

                # Add container name if available
                if hasattr(symbol, 'container_name') and symbol.container_name:
                    symbol_info["container"] = symbol.container_name

                symbol_list.append(symbol_info)

            return self.success_response({
                "file": file_path,
                "symbols": symbol_list,
                "count": len(symbol_list)
            })

        except Exception as e:
            logger.error(f"Failed to get document symbols for {file_path}: {e}")
            return self.fail_response(f"Failed to get document symbols: {str(e)}")

    async def search_workspace_symbols(self, query: str) -> ToolResult:
        """Search for symbols across the entire workspace.

        Args:
            query: Search query (partial symbol name)

        Returns:
            ToolResult with matching symbols
        """
        try:
            await self._ensure_sandbox()

            # Use TypeScript LSP for workspace search (covers most frontend code)
            lsp = await self._ensure_lsp_server('typescript')

            # Search symbols
            symbols = await lsp.workspace_symbols(query)

            results = []
            for symbol in symbols[:50]:  # Limit results
                result = {
                    "name": symbol.name,
                    "kind": str(symbol.kind) if hasattr(symbol, 'kind') else "unknown",
                }

                # Add location if available
                if hasattr(symbol, 'location') and symbol.location:
                    if hasattr(symbol.location, 'uri'):
                        # Extract relative path from URI
                        uri = str(symbol.location.uri)
                        if self.workspace_path in uri:
                            result["file"] = uri.split(self.workspace_path)[-1].lstrip('/')
                        else:
                            result["file"] = uri

                    if hasattr(symbol.location, 'range') and symbol.location.range:
                        result["line"] = symbol.location.range.start.line

                # Add container name if available
                if hasattr(symbol, 'container_name') and symbol.container_name:
                    result["container"] = symbol.container_name

                results.append(result)

            return self.success_response({
                "query": query,
                "results": results,
                "count": len(results)
            })

        except Exception as e:
            logger.error(f"Failed to search workspace symbols for '{query}': {e}")
            return self.fail_response(f"Failed to search workspace symbols: {str(e)}")

    async def cleanup(self):
        """Stop all LSP servers and clean up resources."""
        for language, lsp in self._lsp_servers.items():
            try:
                await lsp.stop()
                logger.info(f"Stopped LSP server for {language}")
            except Exception as e:
                logger.warning(f"Failed to stop LSP server for {language}: {e}")
        self._lsp_servers.clear()
