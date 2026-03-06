"""Workspace search tool with exact grep and semantic file ranking via Relace Code Reranker."""

import re

import httpx

from agentpress.thread_manager import ThreadManager
from agentpress.tool import SchemaType, ToolResult, ToolSchema, XMLNodeMapping, XMLTagSchema
from sandbox.tool_base import SandboxToolsBase
from utils.config import config
from utils.logger import logger

# Security: max pattern length to prevent abuse
MAX_PATTERN_LENGTH = 500
# Max results to prevent context flooding
MAX_GREP_RESULTS = 50
# Max files to send to reranker
MAX_RERANKER_FILES = 200
# Max lines per file for reranker
MAX_LINES_PER_FILE = 500
# Reranker score threshold
RERANKER_SCORE_THRESHOLD = 0.5
# Reranker token limit
RERANKER_TOKEN_LIMIT = 30000

# Dangerous shell patterns to reject
DANGEROUS_PATTERNS = re.compile(r"[\$`|;&]|\$\(|>>|<<")

# Security: files to exclude from reranker API calls
SENSITIVE_FILE_PATTERNS = re.compile(
    r"(\.env|\.key|\.pem|\.cert|credentials|secrets|\.secret)",
    re.IGNORECASE,
)


class SandboxGrepTool(SandboxToolsBase):
    """Hybrid workspace search: exact grep + semantic file ranking via Relace Code Reranker."""

    def __init__(self, project_id: str, thread_manager: ThreadManager, app_type: str = "web"):
        super().__init__(project_id, thread_manager, app_type)

    def get_schemas(self) -> dict[str, list[ToolSchema]]:
        return self.get_tool_schemas()

    def get_tool_schemas(self) -> dict[str, list[ToolSchema]]:
        if self.app_type == "mobile":
            grep_example = "useState"
            find_example = "Where is the navigation logic and tab configuration?"
        else:
            grep_example = "use client"
            find_example = "Where is the auth logic and user session handling?"

        schemas = {}

        # grep_workspace schema
        schemas["grep_workspace"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "grep_workspace",
                        "description": "Search for an exact text pattern across workspace files using ripgrep. Returns matching lines with file paths and line numbers. Use for finding imports, function definitions, variable usage, error strings. Max 50 results.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "pattern": {
                                    "type": "string",
                                    "description": "Text pattern to search for (supports regex). Max 500 characters.",
                                },
                                "file_pattern": {
                                    "type": "string",
                                    "description": "Glob pattern to filter files (e.g., '*.{ts,tsx,js,jsx}'). Defaults to TypeScript/JavaScript files.",
                                    "default": "*.{ts,tsx,js,jsx}",
                                },
                                "case_sensitive": {
                                    "type": "boolean",
                                    "description": "Whether search is case sensitive. Defaults to true.",
                                    "default": True,
                                },
                                "max_results": {
                                    "type": "integer",
                                    "description": "Maximum number of matching lines to return. Defaults to 50.",
                                    "default": 50,
                                },
                            },
                            "required": ["pattern"],
                        },
                    },
                },
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="grep-workspace",
                    mappings=[
                        XMLNodeMapping(param_name="pattern", node_type="content", path="."),
                        XMLNodeMapping(param_name="file_pattern", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="case_sensitive", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="max_results", node_type="attribute", path=".", required=False),
                    ],
                    example=f"""
        <function_calls>
        <invoke name="grep_workspace">
        <parameter name="pattern">{grep_example}</parameter>
        </invoke>
        </function_calls>""",
                ),
            ),
        ]

        # find_relevant_files schema
        schemas["find_relevant_files"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "find_relevant_files",
                        "description": "Search for files most relevant to a task or question using semantic ranking (Relace Code Reranker). Call ONE TIME per turn with all tasks/questions combined. Returns ranked file list with relevance scores.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": "Natural language description of what you're looking for. Include all tasks/questions in one query.",
                                }
                            },
                            "required": ["query"],
                        },
                    },
                },
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="find-relevant-files",
                    mappings=[
                        XMLNodeMapping(param_name="query", node_type="content", path="."),
                    ],
                    example=f"""
        <function_calls>
        <invoke name="find_relevant_files">
        <parameter name="query">{find_example}</parameter>
        </invoke>
        </function_calls>""",
                ),
            ),
        ]

        return schemas

    def _sanitize_pattern(self, pattern: str) -> str | None:
        """Sanitize grep pattern for shell safety. Returns None if dangerous."""
        if len(pattern) > MAX_PATTERN_LENGTH:
            return None
        if DANGEROUS_PATTERNS.search(pattern):
            return None
        return pattern

    async def grep_workspace(
        self,
        pattern: str,
        file_pattern: str = "*.{ts,tsx,js,jsx}",
        case_sensitive: bool = True,
        max_results: int = MAX_GREP_RESULTS,
    ) -> ToolResult:
        """Search workspace files for exact pattern matches using ripgrep."""
        try:
            await self._ensure_sandbox()

            # Sanitize pattern
            safe_pattern = self._sanitize_pattern(pattern)
            if safe_pattern is None:
                return self.fail_response(
                    f"Invalid pattern: must be under {MAX_PATTERN_LENGTH} chars and not contain shell metacharacters ($, `, |, ;, &)."
                )

            # Cap max_results
            max_results = min(max_results, MAX_GREP_RESULTS)

            # Build ripgrep command with individual -g flags for each extension
            case_flag = "" if case_sensitive else " -i"
            # Expand brace patterns into individual -g flags for reliability
            glob_flags = self._expand_glob_pattern(file_pattern)

            cmd = (
                f"rg -n{case_flag} {glob_flags} "
                f"--max-count {max_results} "
                f"--no-heading "
                f"-- {self._shell_quote(safe_pattern)} {self.workspace_path} "
                f"2>/dev/null || "
                f"grep -rn{'' if case_sensitive else 'i'} "
                f"{self._build_grep_includes(file_pattern)} "
                f"-- {self._shell_quote(safe_pattern)} {self.workspace_path} "
                f"2>/dev/null | head -n {max_results}"
            )

            response = await self.sandbox.process.exec(command=cmd, cwd=self.workspace_path, timeout=30)

            output = response.result.strip() if response.result else ""

            if not output:
                return self.success_response(
                    {"message": f"No matches found for pattern: {pattern}", "matches": [], "total": 0}
                )

            # Parse results
            matches = []
            seen_files = set()
            for line in output.split("\n"):
                if not line.strip():
                    continue
                # ripgrep format: filepath:line:content
                parts = line.split(":", 2)
                if len(parts) >= 3:
                    filepath = parts[0].replace(self.workspace_path + "/", "")
                    line_num = parts[1]
                    content = parts[2].strip()
                    matches.append({"file": filepath, "line": line_num, "content": content[:200]})
                    seen_files.add(filepath)

                if len(matches) >= max_results:
                    break

            return self.success_response(
                {
                    "message": f"Found {len(matches)} matches across {len(seen_files)} files",
                    "matches": matches,
                    "total": len(matches),
                    "files_count": len(seen_files),
                }
            )

        except Exception as e:
            return self.fail_response(f"Error searching workspace: {e!s}")

    async def find_relevant_files(self, query: str) -> ToolResult:
        """Rank workspace files by relevance to a query using Relace Code Reranker."""
        try:
            await self._ensure_sandbox()

            # 1. List source files
            find_cmd = (
                f"find {self.workspace_path} -type f "
                r"\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.css' \) "
                r"! -path '*/node_modules/*' ! -path '*/.next/*' ! -path '*/dist/*' ! -path '*/.expo/*' "
                f"| head -{MAX_RERANKER_FILES}"
            )
            file_list_response = await self.sandbox.process.exec(command=find_cmd, cwd=self.workspace_path, timeout=15)

            file_paths = [
                p.strip()
                for p in (file_list_response.result or "").split("\n")
                if p.strip() and not SENSITIVE_FILE_PATTERNS.search(p)
            ]

            if not file_paths:
                return self.success_response({"message": "No source files found in workspace.", "files": []})

            # 2. Read file contents in batch
            codebase = []
            for fpath in file_paths:
                try:
                    raw = await self.sandbox.fs.download_file(fpath)
                    content = raw.decode("utf-8", errors="replace")
                    # Cap at MAX_LINES_PER_FILE
                    lines = content.split("\n")
                    if len(lines) > MAX_LINES_PER_FILE:
                        content = "\n".join(lines[:MAX_LINES_PER_FILE])
                    rel_path = fpath.replace(self.workspace_path + "/", "")
                    codebase.append({"filename": rel_path, "content": content})
                except Exception:
                    continue

            if not codebase:
                return self.success_response({"message": "Could not read any workspace files.", "files": []})

            # 3. Call Relace Code Reranker API
            relace_api_key = config.RELACE_API_KEY
            if not relace_api_key:
                # Fallback: simple keyword grep
                logger.warning("RELACE_API_KEY not configured — falling back to keyword grep")
                return await self._fallback_keyword_search(query)

            results = await self._call_relace_reranker(query, codebase)

            if not results:
                # Fallback if API fails
                return await self._fallback_keyword_search(query)

            # 4. Format response
            ranked_files = []
            for r in results:
                filename = r.get("filename", "")
                score = r.get("score", 0)
                ranked_files.append({"file": filename, "relevance": round(score, 4)})

            return self.success_response(
                {
                    "message": f"Found {len(ranked_files)} relevant files (scored > {RERANKER_SCORE_THRESHOLD})",
                    "files": ranked_files,
                    "total_scanned": len(codebase),
                }
            )

        except Exception as e:
            logger.error(f"Error in find_relevant_files: {e!s}", exc_info=True)
            return self.fail_response(f"Error searching for relevant files: {e!s}")

    async def _call_relace_reranker(self, query: str, codebase: list[dict]) -> list:
        """Call Relace Code Reranker API to rank files by relevance."""
        url = "https://ranker.endpoint.relace.run/v2/code/rank"
        headers = {
            "Authorization": f"Bearer {config.RELACE_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "query": query,
            "codebase": codebase,
            "token_limit": RERANKER_TOKEN_LIMIT,
            "relace_metadata": {"source": "cheatcode-agent"},
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers, json=payload)

                if response.status_code == 200:
                    data = response.json()
                    results = data.get("results", [])
                    usage = data.get("usage", {})
                    logger.info(
                        f"Relace Reranker success — {len(results)} results, tokens: {usage.get('total_tokens', 'N/A')}"
                    )
                    # Filter by score threshold
                    return [r for r in results if r.get("score", 0) >= RERANKER_SCORE_THRESHOLD]

                if response.status_code == 429:
                    logger.warning("Relace Reranker rate limited")
                    return []

                logger.error(f"Relace Reranker error: {response.status_code} — {response.text[:200]}")
                return []

        except httpx.TimeoutException:
            logger.warning("Relace Reranker timeout after 30s")
            return []
        except Exception as e:
            logger.error(f"Relace Reranker call failed: {e!s}")
            return []

    async def _fallback_keyword_search(self, query: str) -> ToolResult:
        """Fallback: extract keywords from query and grep for them."""
        # Simple keyword extraction — take significant words
        stop_words = {
            "the",
            "a",
            "an",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "may",
            "might",
            "can",
            "shall",
            "to",
            "of",
            "in",
            "for",
            "on",
            "with",
            "at",
            "by",
            "from",
            "as",
            "into",
            "through",
            "during",
            "before",
            "after",
            "above",
            "below",
            "between",
            "and",
            "but",
            "or",
            "nor",
            "not",
            "so",
            "if",
            "then",
            "than",
            "that",
            "this",
            "these",
            "those",
            "it",
            "its",
            "i",
            "me",
            "my",
            "we",
            "our",
            "you",
            "your",
            "he",
            "she",
            "they",
            "them",
            "what",
            "which",
            "who",
            "where",
            "when",
            "how",
            "why",
            "all",
            "each",
            "every",
            "any",
            "few",
            "more",
            "most",
            "other",
            "some",
            "such",
            "no",
            "only",
            "same",
            "find",
            "search",
            "look",
            "get",
            "file",
            "files",
            "code",
        }
        words = re.findall(r"\b[a-zA-Z]+\b", query.lower())
        keywords = [w for w in words if w not in stop_words and len(w) > 2][:5]

        if not keywords:
            return self.success_response({"message": "Could not extract meaningful keywords from query.", "files": []})

        # Grep for each keyword and count file hits
        file_scores: dict[str, int] = {}
        for keyword in keywords:
            result = await self.grep_workspace(keyword, max_results=30)
            if result.success:
                import json

                data = json.loads(result.output) if isinstance(result.output, str) else result.output
                for match in data.get("matches", []):
                    f = match.get("file", "")
                    file_scores[f] = file_scores.get(f, 0) + 1

        # Sort by hit count
        ranked = sorted(file_scores.items(), key=lambda x: -x[1])[:15]
        ranked_files = [{"file": f, "keyword_hits": score} for f, score in ranked]

        return self.success_response(
            {
                "message": f"Keyword fallback: found {len(ranked_files)} files matching keywords: {', '.join(keywords)}",
                "files": ranked_files,
                "fallback": True,
            }
        )

    @staticmethod
    def _shell_quote(s: str) -> str:
        """Safely quote a string for shell usage."""
        return "'" + s.replace("'", "'\\''") + "'"

    @staticmethod
    def _expand_glob_pattern(pattern: str) -> str:
        """Expand a brace glob pattern into individual -g flags for ripgrep."""
        # Handle patterns like *.{ts,tsx,js,jsx}
        match = re.match(r"^\*\.\{(.+)\}$", pattern)
        if match:
            exts = match.group(1).split(",")
            return " ".join(f"-g '*.{ext.strip()}'" for ext in exts)
        return f"-g '{pattern}'"

    @staticmethod
    def _build_grep_includes(pattern: str) -> str:
        """Build --include flags for GNU grep from a glob pattern."""
        match = re.match(r"^\*\.\{(.+)\}$", pattern)
        if match:
            exts = match.group(1).split(",")
            return " ".join(f"--include='*.{ext.strip()}'" for ext in exts)
        return f"--include='{pattern}'"
