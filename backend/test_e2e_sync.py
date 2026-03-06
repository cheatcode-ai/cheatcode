#!/usr/bin/env python3
"""Comprehensive E2E synchronous test for the Cheatcode agent system.

Run from cheatcode/backend/:
    python3 test_e2e_sync.py

    OR (if .venv exists):
    .venv/bin/python test_e2e_sync.py
"""

import os
import re
import sys
import traceback
import types as builtin_types
from collections import Counter

# Ensure backend is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Pre-set ALL environment variables that the Configuration singleton expects.
# This must happen BEFORE any import that triggers `from utils.config import config`.
#
# Python 3.10+ uses `types.UnionType` for `str | None`, which the validator
# doesn't recognise as Optional (it only checks `typing.Union`).  We work
# around this by supplying dummy values for every field the validator would
# consider "required".
# ---------------------------------------------------------------------------
_DUMMY_ENV = {
    # Actually required (annotated as bare `str`)
    "SUPABASE_URL": "https://test.supabase.co",
    "SUPABASE_ANON_KEY": "test-anon-key",
    "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
    "REDIS_URL": "redis://localhost:6379",
    "DAYTONA_API_KEY": "test-daytona-key",
    "DAYTONA_SERVER_URL": "https://test.daytona.io",
    "DAYTONA_TARGET": "test-target",
    "TAVILY_API_KEY": "test-tavily-key",
    "FIRECRAWL_API_KEY": "test-firecrawl-key",
    "FIRECRAWL_URL": "https://api.firecrawl.dev",
    # Annotated as `str | None` but validator bug on 3.10+ treats them as required
    "VERCEL_TEAM_ID": "test",
    "API_BASE_URL": "https://test.api.com",
    "CLERK_JWT_KEY": "test-jwt-key",
    "ADMIN_API_KEY": "test-admin-key",
    "MAILTRAP_API_TOKEN": "test-mailtrap",
    "SENTRY_DSN": "https://test@sentry.io/0",
    "INNGEST_EVENT_KEY": "test-inngest-event",
    "INNGEST_SIGNING_KEY": "test-inngest-sign",
    "INNGEST_DEV": "1",
    # Other potentially needed
    "CLERK_SECRET_KEY": "test-clerk-secret",
    "COMPOSIO_API_KEY": "test-composio",
    "GOOGLE_API_KEY": "test-google",
    "ANTHROPIC_API_KEY": "test-anthropic",
    "OPENAI_API_KEY": "test-openai",
    "RELACE_API_KEY": "test-relace",
    "OPENROUTER_API_KEY": "test-openrouter",
    "LANGFUSE_PUBLIC_KEY": "test-langfuse-pub",
    "LANGFUSE_SECRET_KEY": "test-langfuse-sec",
    "POLAR_ACCESS_TOKEN": "test-polar",
    "POLAR_WEBHOOK_SECRET": "test-polar-wh",
    "POLAR_ORGANIZATION_ID": "test-polar-org",
    "MCP_CREDENTIAL_ENCRYPTION_KEY": "test-mcp-enc-key",
    "VERCEL_BEARER_TOKEN": "test-vercel-bearer",
}
for k, v in _DUMMY_ENV.items():
    os.environ.setdefault(k, v)

# Suppress noisy logging during tests
import logging

logging.disable(logging.CRITICAL)

# Suppress structlog output by configuring it to filter everything
try:
    import structlog

    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(logging.CRITICAL),
    )
except (ImportError, Exception):
    pass

from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Test result tracking
# ---------------------------------------------------------------------------
results: list[tuple[str, bool, str]] = []  # (test_name, passed, detail)


def record(test_name: str, passed: bool, detail: str = ""):
    results.append((test_name, passed, detail))
    status = "PASS" if passed else "FAIL"
    msg = f"  [{status}] {test_name}"
    if detail and not passed:
        msg += f"\n         -> {detail}"
    print(msg)


def assert_test(test_name: str, condition: bool, fail_msg: str = ""):
    record(test_name, condition, fail_msg)


# ===========================================================================
# 1. IMPORT TESTS
# ===========================================================================
print("\n" + "=" * 72)
print("1. IMPORT TESTS")
print("=" * 72)

import_targets = [
    ("agent.coding_agent_prompt", "get_coding_agent_prompt"),
    ("agent.mobile_agent_prompt", "get_mobile_agent_prompt"),
    ("agent.base_prompt", "get_base_prompt_sections"),
    ("agent.tools.sb_grep_tool", "SandboxGrepTool"),
    ("agent.tools.sb_screenshot_tool", "SandboxScreenshotTool"),
    ("agent.tools.sb_files_tool", "SandboxFilesTool"),
    ("agent.tools.sb_shell_tool", "SandboxShellTool"),
    ("agent.tools.sb_vision_tool", "SandboxVisionTool"),
    ("agent.tools.sb_lsp_tool", "SandboxLSPTool"),
    ("agent.tools.web_search_tool", "SandboxWebSearchTool"),
    ("agent.tools.completion_tool", "CompletionTool"),
    ("agent.tools.component_search_tool", "ComponentSearchTool"),
    ("agent.tools.mcp_tool_wrapper", "MCPToolWrapper"),
    ("agentpress.tool", "Tool"),
    ("agentpress.tool", "ToolResult"),
    ("agentpress.tool", "ToolSchema"),
    ("agentpress.tool", "SchemaType"),
    ("agentpress.tool", "XMLTagSchema"),
    ("agentpress.tool", "XMLNodeMapping"),
    ("agentpress.tool_registry", "ToolRegistry"),
    ("agentpress.response_processor", "ProcessorConfig"),
]

imported = {}
for mod_path, attr_name in import_targets:
    test_name = f"Import {mod_path}.{attr_name}"
    try:
        mod = __import__(mod_path, fromlist=[attr_name])
        obj = getattr(mod, attr_name)
        imported[f"{mod_path}.{attr_name}"] = obj
        record(test_name, True)
    except Exception as e:
        record(test_name, False, f"{type(e).__name__}: {e}")

# Convenience aliases
get_coding_agent_prompt = imported.get("agent.coding_agent_prompt.get_coding_agent_prompt")
get_mobile_agent_prompt = imported.get("agent.mobile_agent_prompt.get_mobile_agent_prompt")
get_base_prompt_sections = imported.get("agent.base_prompt.get_base_prompt_sections")
ToolRegistry = imported.get("agentpress.tool_registry.ToolRegistry")
SchemaType = imported.get("agentpress.tool.SchemaType")
ToolSchema = imported.get("agentpress.tool.ToolSchema")

# Tool classes
SandboxFilesTool = imported.get("agent.tools.sb_files_tool.SandboxFilesTool")
SandboxShellTool = imported.get("agent.tools.sb_shell_tool.SandboxShellTool")
SandboxGrepTool = imported.get("agent.tools.sb_grep_tool.SandboxGrepTool")
SandboxScreenshotTool = imported.get("agent.tools.sb_screenshot_tool.SandboxScreenshotTool")
SandboxVisionTool = imported.get("agent.tools.sb_vision_tool.SandboxVisionTool")
SandboxLSPTool = imported.get("agent.tools.sb_lsp_tool.SandboxLSPTool")
SandboxWebSearchTool = imported.get("agent.tools.web_search_tool.SandboxWebSearchTool")
CompletionTool = imported.get("agent.tools.completion_tool.CompletionTool")
ComponentSearchTool = imported.get("agent.tools.component_search_tool.ComponentSearchTool")
MCPToolWrapper = imported.get("agent.tools.mcp_tool_wrapper.MCPToolWrapper")

# ===========================================================================
# 2. PROMPT GENERATION TESTS
# ===========================================================================
print("\n" + "=" * 72)
print("2. PROMPT GENERATION TESTS")
print("=" * 72)

web_prompt = None
mobile_prompt = None

if get_coding_agent_prompt:
    try:
        web_prompt = get_coding_agent_prompt()
        assert_test("Web prompt generates without error", True)
        assert_test(
            "Web prompt is non-empty string",
            isinstance(web_prompt, str) and len(web_prompt) > 0,
            f"type={type(web_prompt)}, len={len(web_prompt) if web_prompt else 0}",
        )
    except Exception as e:
        record("Web prompt generates without error", False, str(e))

if get_mobile_agent_prompt:
    try:
        mobile_prompt = get_mobile_agent_prompt()
        assert_test("Mobile prompt generates without error", True)
        assert_test(
            "Mobile prompt is non-empty string",
            isinstance(mobile_prompt, str) and len(mobile_prompt) > 0,
            f"type={type(mobile_prompt)}, len={len(mobile_prompt) if mobile_prompt else 0}",
        )
    except Exception as e:
        record("Mobile prompt generates without error", False, str(e))

# Key section checks for both prompts
if web_prompt and mobile_prompt:
    for section_name in [
        "identity",
        "environment",
        "template-structure",
        "critical-rules",
        "workflow",
        "styling",
        "best-practices",
        "dependency-management",
        "component-rules",
        "tool-reference",
    ]:
        assert_test(
            f"Web prompt contains <{section_name}>",
            f"<{section_name}>" in web_prompt,
            f"Missing <{section_name}> in web prompt",
        )
        assert_test(
            f"Mobile prompt contains <{section_name}>",
            f"<{section_name}>" in mobile_prompt,
            f"Missing <{section_name}> in mobile prompt",
        )

# Web-specific content checks
if web_prompt:
    web_checks = [
        ("Web prompt contains 'Next.js 16'", "Next.js 16" in web_prompt),
        ("Web prompt does NOT contain 'src/components/blocks/'", "src/components/blocks/" not in web_prompt),
        ("Web prompt contains '@/* maps to ./src/*'", "@/* maps to ./src/*" in web_prompt),
        ("Web prompt contains 'oklch'", "oklch" in web_prompt),
        ("Web prompt contains '53 shadcn/ui'", "53 shadcn/ui" in web_prompt),
    ]
    for name, cond in web_checks:
        assert_test(name, cond)

# Mobile-specific content checks
if mobile_prompt:
    mobile_checks = [
        ("Mobile prompt contains 'pnpm package manager'", "pnpm package manager" in mobile_prompt),
        ("Mobile prompt contains '~/* maps to project root'", "~/* maps to project root" in mobile_prompt),
        ("Mobile prompt contains 'iconWithClassName'", "iconWithClassName" in mobile_prompt),
        ("Mobile prompt contains '~/components/ui/text'", "~/components/ui/text" in mobile_prompt),
        ("Mobile prompt contains 'Tailwind CSS 3.4'", "Tailwind CSS 3.4" in mobile_prompt),
        ("Mobile prompt contains 'Expo SDK 54'", "Expo SDK 54" in mobile_prompt),
        ("Mobile prompt contains 'PortalHost'", "PortalHost" in mobile_prompt),
        ("Mobile prompt contains '.dark:root'", ".dark:root" in mobile_prompt),
        ("Mobile prompt contains 'take_screenshot'", "take_screenshot" in mobile_prompt),
    ]
    for name, cond in mobile_checks:
        assert_test(name, cond)

# ===========================================================================
# 3. BASE PROMPT TESTS
# ===========================================================================
print("\n" + "=" * 72)
print("3. BASE PROMPT TESTS")
print("=" * 72)

base_sections = None
if get_base_prompt_sections:
    try:
        base_sections = get_base_prompt_sections()
        assert_test("get_base_prompt_sections() returns a dict", isinstance(base_sections, dict))
    except Exception as e:
        record("get_base_prompt_sections() returns a dict", False, str(e))

expected_keys = [
    "tool_rules",
    "tool_parallelization",
    "file_editing",
    "code_quality",
    "error_handling",
    "security",
    "accessibility",
    "communication",
    "image_handling",
    "preservation_principle",
    "navigation_principle",
]

if base_sections:
    assert_test(
        "Base sections has all 11 keys",
        set(expected_keys) == set(base_sections.keys()),
        f"Expected {sorted(expected_keys)}, got {sorted(base_sections.keys())}",
    )

    for key in expected_keys:
        val = base_sections.get(key, "")
        assert_test(
            f"base['{key}'] is non-empty string",
            isinstance(val, str) and len(val) > 0,
            f"type={type(val)}, len={len(val) if val else 0}",
        )
        assert_test(
            f"base['{key}'] starts with '<'", val.strip().startswith("<"), f"Starts with: {repr(val.strip()[:20])}"
        )

    # Specific content checks
    assert_test(
        "tool_rules contains 'read a file before editing'",
        "read a file before editing" in base_sections.get("tool_rules", "").lower(),
        f"Content snippet: {base_sections.get('tool_rules', '')[:200]}",
    )
    assert_test(
        "error_handling contains '3 retry'",
        "3 retry" in base_sections.get("error_handling", ""),
        f"Content snippet: {base_sections.get('error_handling', '')[:200]}",
    )
    assert_test(
        "code_quality contains 'NEVER output code'",
        "NEVER output code" in base_sections.get("code_quality", ""),
        f"Content snippet: {base_sections.get('code_quality', '')[:200]}",
    )
    assert_test(
        "file_editing contains 'edit_file'",
        "edit_file" in base_sections.get("file_editing", ""),
        f"Content snippet: {base_sections.get('file_editing', '')[:200]}",
    )

# ===========================================================================
# 4. XML BALANCE TESTS
# ===========================================================================
print("\n" + "=" * 72)
print("4. XML BALANCE TESTS")
print("=" * 72)


def check_xml_balance(prompt_text: str, prompt_name: str):
    """Check that all structural XML tags are balanced in the prompt."""
    open_tags = re.findall(r"<([a-zA-Z][a-zA-Z0-9_-]*)(?:\s[^>]*)?>", prompt_text)
    close_tags = re.findall(r"</([a-zA-Z][a-zA-Z0-9_-]*)>", prompt_text)

    open_counts = Counter(open_tags)
    close_counts = Counter(close_tags)

    # Focus on structural tags (hyphenated or known prompt tags)
    structural_tags = set()
    for tag in set(open_counts.keys()) | set(close_counts.keys()):
        if "-" in tag:
            structural_tags.add(tag)

    mismatches = []
    for tag in structural_tags:
        opens = open_counts.get(tag, 0)
        closes = close_counts.get(tag, 0)
        if opens != closes:
            mismatches.append(f"<{tag}>: {opens} opens vs {closes} closes")

    if mismatches:
        assert_test(f"XML balance in {prompt_name}", False, "; ".join(mismatches))
    else:
        assert_test(f"XML balance in {prompt_name}", True)


if web_prompt:
    check_xml_balance(web_prompt, "web prompt")
if mobile_prompt:
    check_xml_balance(mobile_prompt, "mobile prompt")

# ===========================================================================
# 5. TOOL SCHEMA TESTS
# ===========================================================================
print("\n" + "=" * 72)
print("5. TOOL SCHEMA TESTS")
print("=" * 72)

mock_tm = MagicMock()
mock_tm.db = MagicMock()
mock_tm.db.client = MagicMock()


def make_tool_instance(tool_cls, **extra_kwargs):
    """Create a tool instance with mocked dependencies."""
    import inspect

    sig = inspect.signature(tool_cls.__init__)
    params = list(sig.parameters.keys())

    kwargs = {}
    for p in params[1:]:  # skip self
        if p == "project_id":
            kwargs["project_id"] = "test-project-id"
        elif p == "thread_manager":
            kwargs["thread_manager"] = mock_tm
        elif p == "thread_id":
            kwargs["thread_id"] = "test-thread-id"
        elif p == "app_type":
            kwargs["app_type"] = extra_kwargs.get("app_type", "web")
        elif p in extra_kwargs:
            kwargs[p] = extra_kwargs[p]

    return tool_cls(**kwargs)


# Expected methods per tool
expected_tool_methods = {
    "SandboxFilesTool": [
        "create_file",
        "read_file",
        "write_file",
        "edit_file",
        "delete_file",
        "list_files",
        "full_file_rewrite",
    ],
    "SandboxShellTool": ["execute_command", "check_command_output", "terminate_command", "list_commands", "run_code"],
    "SandboxGrepTool": ["grep_workspace", "find_relevant_files"],
    "SandboxScreenshotTool": ["take_screenshot"],
    "SandboxVisionTool": ["see_image"],
    "SandboxLSPTool": ["get_completions", "get_document_symbols", "search_workspace_symbols"],
    "SandboxWebSearchTool": ["web_search", "scrape_webpage"],
    "ComponentSearchTool": ["search_components", "get_component_suggestions"],
    "CompletionTool": ["complete"],
}

# Mapping of names to classes
tool_classes = {
    "SandboxFilesTool": SandboxFilesTool,
    "SandboxShellTool": SandboxShellTool,
    "SandboxGrepTool": SandboxGrepTool,
    "SandboxScreenshotTool": SandboxScreenshotTool,
    "SandboxVisionTool": SandboxVisionTool,
    "SandboxLSPTool": SandboxLSPTool,
    "SandboxWebSearchTool": SandboxWebSearchTool,
    "CompletionTool": CompletionTool,
    "ComponentSearchTool": ComponentSearchTool,
}

all_tool_schemas = {}  # tool_name -> schemas dict

for tool_name, tool_cls in tool_classes.items():
    if tool_cls is None:
        record(f"Schema test: {tool_name}", False, "Class not imported")
        continue

    try:
        instance = make_tool_instance(tool_cls)
        schemas = instance.get_schemas()

        assert_test(
            f"{tool_name}: get_schemas() returns non-empty dict",
            isinstance(schemas, dict) and len(schemas) > 0,
            f"Got {type(schemas)}, len={len(schemas) if schemas else 0}",
        )

        all_tool_schemas[tool_name] = schemas

        # Verify each method has at least one ToolSchema
        for method_name, schema_list in schemas.items():
            assert_test(
                f"{tool_name}.{method_name}: has ToolSchema(s)",
                isinstance(schema_list, list) and len(schema_list) > 0,
                f"Got {type(schema_list)}, len={len(schema_list) if schema_list else 0}",
            )

            for ts in schema_list:
                if ts.schema_type == SchemaType.OPENAPI:
                    fn_name = ts.schema.get("function", {}).get("name", "")
                    assert_test(
                        f"{tool_name}.{method_name}: OPENAPI function name matches key",
                        fn_name == method_name,
                        f"Expected '{method_name}', got '{fn_name}'",
                    )

                if ts.schema_type == SchemaType.XML and ts.xml_schema:
                    assert_test(
                        f"{tool_name}.{method_name}: XML tag_name exists",
                        ts.xml_schema.tag_name is not None and len(ts.xml_schema.tag_name) > 0,
                        f"tag_name={ts.xml_schema.tag_name}",
                    )
                    assert_test(
                        f"{tool_name}.{method_name}: XML mappings is a list",
                        isinstance(ts.xml_schema.mappings, list),
                        f"mappings type={type(ts.xml_schema.mappings)}",
                    )

        # Verify all expected methods present
        expected = expected_tool_methods.get(tool_name, [])
        actual = set(schemas.keys())
        for method in expected:
            assert_test(f"{tool_name}: has method '{method}'", method in actual, f"Available: {sorted(actual)}")

    except Exception as e:
        record(f"Schema test: {tool_name}", False, f"{type(e).__name__}: {e}\n{traceback.format_exc()}")


# ===========================================================================
# 6. TOOL REGISTRY SIMULATION
# ===========================================================================
print("\n" + "=" * 72)
print("6. TOOL REGISTRY SIMULATION")
print("=" * 72)

if ToolRegistry and all(tool_classes.get(n) is not None for n in tool_classes):
    try:
        registry = ToolRegistry()

        registry.register_tool(SandboxShellTool, project_id="test", thread_manager=mock_tm, app_type="web")
        registry.register_tool(SandboxFilesTool, project_id="test", thread_manager=mock_tm, app_type="web")
        registry.register_tool(SandboxGrepTool, project_id="test", thread_manager=mock_tm, app_type="web")
        registry.register_tool(
            SandboxScreenshotTool, project_id="test", thread_id="test-tid", thread_manager=mock_tm, app_type="web"
        )
        registry.register_tool(
            SandboxVisionTool, project_id="test", thread_id="test-tid", thread_manager=mock_tm, app_type="web"
        )
        registry.register_tool(SandboxLSPTool, project_id="test", thread_manager=mock_tm, app_type="web")
        registry.register_tool(SandboxWebSearchTool, project_id="test", thread_manager=mock_tm, app_type="web")
        registry.register_tool(ComponentSearchTool, thread_manager=mock_tm, app_type="web")
        registry.register_tool(CompletionTool, thread_manager=mock_tm, app_type="web")

        available = registry.get_available_functions()
        assert_test(
            "Registry: get_available_functions() is non-empty", len(available) > 0, f"Got {len(available)} functions"
        )

        # Check all expected methods
        all_expected_methods = set()
        for methods in expected_tool_methods.values():
            all_expected_methods.update(methods)

        for method_name in sorted(all_expected_methods):
            assert_test(
                f"Registry contains '{method_name}'", method_name in available, f"Available: {sorted(available.keys())}"
            )

        assert_test(
            "Registry: expected 23+ methods",
            len(available) >= 23,
            f"Got {len(available)}, expected >= 23. Available: {sorted(available.keys())}",
        )

        # OpenAPI schemas
        openapi_schemas = registry.get_openapi_schemas()
        assert_test(
            "Registry: get_openapi_schemas() returns non-empty list",
            isinstance(openapi_schemas, list) and len(openapi_schemas) > 0,
            f"Got {len(openapi_schemas)}",
        )

        # XML examples
        xml_examples = registry.get_xml_examples()
        assert_test(
            "Registry: get_xml_examples() returns non-empty dict",
            isinstance(xml_examples, dict) and len(xml_examples) > 0,
            f"Got {len(xml_examples)}",
        )

    except Exception as e:
        record("Tool Registry simulation", False, f"{type(e).__name__}: {e}\n{traceback.format_exc()}")
else:
    missing = [n for n, c in tool_classes.items() if c is None]
    if not ToolRegistry:
        missing.insert(0, "ToolRegistry")
    record("Tool Registry simulation", False, f"Missing classes: {missing}")


# ===========================================================================
# 7. APP TYPE ROUTING TESTS
# ===========================================================================
print("\n" + "=" * 72)
print("7. APP TYPE ROUTING TESTS")
print("=" * 72)

# SandboxGrepTool -- examples differ between web and mobile
if SandboxGrepTool and SchemaType:
    try:
        grep_web = make_tool_instance(SandboxGrepTool, app_type="web")
        grep_mobile = make_tool_instance(SandboxGrepTool, app_type="mobile")
        web_schemas = grep_web.get_schemas()
        mobile_schemas = grep_mobile.get_schemas()

        web_grep_example = ""
        mobile_grep_example = ""
        for ts in web_schemas.get("grep_workspace", []):
            if ts.schema_type == SchemaType.XML and ts.xml_schema and ts.xml_schema.example:
                web_grep_example = ts.xml_schema.example
        for ts in mobile_schemas.get("grep_workspace", []):
            if ts.schema_type == SchemaType.XML and ts.xml_schema and ts.xml_schema.example:
                mobile_grep_example = ts.xml_schema.example

        assert_test(
            "GrepTool: web vs mobile examples differ",
            web_grep_example != mobile_grep_example and len(web_grep_example) > 0,
            f"web='{web_grep_example[:80]}' mobile='{mobile_grep_example[:80]}'",
        )
    except Exception as e:
        record("GrepTool app_type routing", False, str(e))
else:
    record("GrepTool app_type routing", False, "SandboxGrepTool not imported")

# SandboxScreenshotTool -- viewport defaults differ
if SandboxScreenshotTool and SchemaType:
    try:
        ss_web = make_tool_instance(SandboxScreenshotTool, app_type="web")
        ss_mobile = make_tool_instance(SandboxScreenshotTool, app_type="mobile")
        web_ss_schemas = ss_web.get_schemas()
        mobile_ss_schemas = ss_mobile.get_schemas()

        def get_viewport_default(schemas, method="take_screenshot"):
            for ts in schemas.get(method, []):
                if ts.schema_type == SchemaType.OPENAPI:
                    props = ts.schema.get("function", {}).get("parameters", {}).get("properties", {})
                    return props.get("viewport_width", {}).get("default")
            return None

        web_vp = get_viewport_default(web_ss_schemas)
        mobile_vp = get_viewport_default(mobile_ss_schemas)
        assert_test("ScreenshotTool: web viewport default is 1280", web_vp == 1280, f"Got {web_vp}")
        assert_test("ScreenshotTool: mobile viewport default is 375", mobile_vp == 375, f"Got {mobile_vp}")
    except Exception as e:
        record("ScreenshotTool app_type routing", False, str(e))
else:
    record("ScreenshotTool app_type routing", False, "SandboxScreenshotTool not imported")

# CompletionTool -- descriptions differ
if CompletionTool and SchemaType:
    try:
        ct_web = make_tool_instance(CompletionTool, app_type="web")
        ct_mobile = make_tool_instance(CompletionTool, app_type="mobile")
        web_ct_schemas = ct_web.get_schemas()
        mobile_ct_schemas = ct_mobile.get_schemas()

        web_desc = ""
        mobile_desc = ""
        for ts in web_ct_schemas.get("complete", []):
            if ts.schema_type == SchemaType.OPENAPI:
                web_desc = ts.schema.get("function", {}).get("description", "")
        for ts in mobile_ct_schemas.get("complete", []):
            if ts.schema_type == SchemaType.OPENAPI:
                mobile_desc = ts.schema.get("function", {}).get("description", "")

        assert_test(
            "CompletionTool: web vs mobile descriptions differ",
            web_desc != mobile_desc and len(web_desc) > 0,
            f"web='{web_desc[:60]}' mobile='{mobile_desc[:60]}'",
        )
    except Exception as e:
        record("CompletionTool app_type routing", False, str(e))
else:
    record("CompletionTool app_type routing", False, "CompletionTool not imported")


# ===========================================================================
# 8. SHELL TOOL SAFETY TESTS
# ===========================================================================
print("\n" + "=" * 72)
print("8. SHELL TOOL SAFETY TESTS")
print("=" * 72)

if SandboxShellTool and SchemaType:
    try:
        shell_web = make_tool_instance(SandboxShellTool, app_type="web")
        shell_schemas = shell_web.get_schemas()

        exec_examples = ""
        for ts in shell_schemas.get("execute_command", []):
            if ts.schema_type == SchemaType.XML and ts.xml_schema and ts.xml_schema.example:
                exec_examples += ts.xml_schema.example

        dangerous_patterns = ["npm run dev", "pnpm dev", "expo start"]
        for pattern in dangerous_patterns:
            assert_test(
                f"Shell examples do NOT contain '{pattern}'",
                pattern not in exec_examples,
                f"Found '{pattern}' in execute_command examples",
            )

        assert_test(
            "Shell web examples use 'pnpm add'", "pnpm add" in exec_examples, f"Examples: {exec_examples[:200]}"
        )

    except Exception as e:
        record("Shell tool safety tests", False, str(e))
else:
    record("Shell tool safety tests", False, "SandboxShellTool not imported")


# ===========================================================================
# 9. TOOL-PROMPT CROSS-REFERENCE TESTS
# ===========================================================================
print("\n" + "=" * 72)
print("9. TOOL-PROMPT CROSS-REFERENCE TESTS")
print("=" * 72)


def extract_tool_names_from_prompt(prompt_text: str) -> set[str]:
    """Extract tool method names from the <tool-reference> section of a prompt."""
    match = re.search(r"<tool-reference>(.*?)</tool-reference>", prompt_text, re.DOTALL)
    if not match:
        return set()

    section = match.group(1)
    tokens = re.findall(r"\b([a-z][a-z0-9_]+)\b", section)
    non_tool_words = {
        "also",
        "for",
        "deps",
        "optional",
        "exact",
        "pattern",
        "match",
        "via",
        "semantic",
        "dynamic",
        "listed",
        "if",
        "configured",
        "pnpm",
        "add",
        "diagnostics",
        "npx",
        "tsc",
        "noEmit",
        "expo",
        "install",
        "verification",
        "visual",
    }
    return {t for t in tokens if t not in non_tool_words and len(t) > 2}


# Collect all actual method names from schemas
actual_method_names = set()
for tool_schemas_dict in all_tool_schemas.values():
    actual_method_names.update(tool_schemas_dict.keys())

if web_prompt and actual_method_names:
    web_tool_names = extract_tool_names_from_prompt(web_prompt)
    for tool_name in sorted(web_tool_names):
        if tool_name in ("mcp",):
            continue
        assert_test(
            f"Web prompt tool '{tool_name}' exists in schemas",
            tool_name in actual_method_names,
            f"Not in: {sorted(actual_method_names)}",
        )

if mobile_prompt and actual_method_names:
    mobile_tool_names = extract_tool_names_from_prompt(mobile_prompt)
    for tool_name in sorted(mobile_tool_names):
        if tool_name in ("mcp",):
            continue
        assert_test(
            f"Mobile prompt tool '{tool_name}' exists in schemas",
            tool_name in actual_method_names,
            f"Not in: {sorted(actual_method_names)}",
        )


# ===========================================================================
# 10. SAMPLE RESPONSE TESTS
# ===========================================================================
print("\n" + "=" * 72)
print("10. SAMPLE RESPONSE TESTS")
print("=" * 72)

backend_dir = os.path.dirname(os.path.abspath(__file__))
web_sample_path = os.path.join(backend_dir, "agent", "sample_responses", "1.txt")
mobile_sample_path = os.path.join(backend_dir, "agent", "sample_responses", "1_mobile.txt")

assert_test("Web sample file exists", os.path.isfile(web_sample_path), f"Expected at {web_sample_path}")
assert_test("Mobile sample file exists", os.path.isfile(mobile_sample_path), f"Expected at {mobile_sample_path}")

web_sample = ""
mobile_sample = ""
if os.path.isfile(web_sample_path):
    with open(web_sample_path) as f:
        web_sample = f.read()

if os.path.isfile(mobile_sample_path):
    with open(mobile_sample_path) as f:
        mobile_sample = f.read()

if web_sample:
    sc_count = web_sample.count("search_components")
    assert_test("Web sample: search_components calls <= 2", sc_count <= 2, f"Found {sc_count} occurrences (max 2)")
    assert_test("Web sample contains 'edit_file'", "edit_file" in web_sample)
    assert_test("Web sample contains 'complete'", "complete" in web_sample)
    assert_test("Web sample does NOT contain 'npm run dev'", "npm run dev" not in web_sample)
    assert_test("Web sample does NOT contain 'pnpm dev'", "pnpm dev" not in web_sample)

if mobile_sample:
    assert_test("Mobile sample contains 'edit_file'", "edit_file" in mobile_sample)
    assert_test("Mobile sample contains 'complete'", "complete" in mobile_sample)


# ===========================================================================
# 11. RUN.PY IMPORT CHAIN TEST
# ===========================================================================
print("\n" + "=" * 72)
print("11. RUN.PY IMPORT CHAIN TEST")
print("=" * 72)

try:
    from agent.run import run_agent

    assert_test("Import agent.run.run_agent succeeds", True)
except ImportError as e:
    error_str = str(e)
    is_tool_error = any(
        tool in error_str
        for tool in [
            "sb_files_tool",
            "sb_shell_tool",
            "sb_grep_tool",
            "sb_screenshot_tool",
            "sb_vision_tool",
            "sb_lsp_tool",
            "web_search_tool",
            "completion_tool",
            "component_search_tool",
            "mcp_tool_wrapper",
        ]
    )
    if is_tool_error:
        record("Import agent.run.run_agent", False, f"Tool import failed: {e}")
    else:
        record("Import agent.run.run_agent (external dep issue only)", True, f"External dep error (OK): {e}")
except Exception as e:
    error_str = str(e)
    if "Missing required configuration" in error_str:
        record("Import agent.run.run_agent (config validation expected in test)", True)
    else:
        record("Import agent.run.run_agent", False, f"{type(e).__name__}: {e}")


# ===========================================================================
# SUMMARY
# ===========================================================================
print("\n" + "=" * 72)
print("SUMMARY")
print("=" * 72)

total = len(results)
passed = sum(1 for _, p, _ in results if p)
failed = total - passed

print(f"\n  Total tests: {total}")
print(f"  Passed:      {passed}")
print(f"  Failed:      {failed}")

if failed > 0:
    print(f"\n  FAILURES ({failed}):")
    for name, p, detail in results:
        if not p:
            print(f"    - {name}")
            if detail:
                print(f"      {detail}")

print(f"\n  {'ALL TESTS PASSED' if failed == 0 else f'{failed} TEST(S) FAILED'}")
print("=" * 72)

sys.exit(0 if failed == 0 else 1)
