"""Preview screenshot tool for visual verification of the agent's work."""

import base64

from agentpress.thread_manager import ThreadManager
from agentpress.tool import SchemaType, ToolResult, ToolSchema, XMLNodeMapping, XMLTagSchema
from sandbox.tool_base import SandboxToolsBase
from utils.logger import logger

# Compression settings (reused from sb_vision_tool.py)
DEFAULT_MAX_WIDTH = 1920
DEFAULT_MAX_HEIGHT = 1080
DEFAULT_JPEG_QUALITY = 85
MAX_COMPRESSED_SIZE = 5 * 1024 * 1024  # 5MB


class SandboxScreenshotTool(SandboxToolsBase):
    """Capture screenshots of the live preview for visual verification.

    Speed note: costs ~5-10s per call. NOT called by default.
    Only use when: (1) debugging visual issues, (2) user asks to verify appearance,
    (3) task explicitly involves UI matching.
    """

    def __init__(
        self,
        project_id: str,
        thread_id: str,
        thread_manager: ThreadManager,
        app_type: str = "web",
    ):
        super().__init__(project_id, thread_manager, app_type)
        self.thread_id = thread_id
        self.thread_manager = thread_manager

    def get_schemas(self) -> dict[str, list[ToolSchema]]:
        return self.get_tool_schemas()

    def get_tool_schemas(self) -> dict[str, list[ToolSchema]]:
        port = 8081 if self.app_type == "mobile" else 3000
        default_width = 375 if self.app_type == "mobile" else 1280
        default_height = 812 if self.app_type == "mobile" else 720

        schemas = {}

        schemas["take_screenshot"] = [
            ToolSchema(
                schema_type=SchemaType.OPENAPI,
                schema={
                    "type": "function",
                    "function": {
                        "name": "take_screenshot",
                        "description": f"Capture a screenshot of the live preview (port {port}). OPTIONAL — only use when debugging visual issues or when user requests visual verification. Costs ~5-10s.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "URL path to screenshot (e.g., '/' for home, '/about' for about page). Defaults to '/'.",
                                    "default": "/",
                                },
                                "viewport_width": {
                                    "type": "integer",
                                    "description": f"Viewport width in pixels. Defaults to {default_width}.",
                                    "default": default_width,
                                },
                                "viewport_height": {
                                    "type": "integer",
                                    "description": f"Viewport height in pixels. Defaults to {default_height}.",
                                    "default": default_height,
                                },
                                "full_page": {
                                    "type": "boolean",
                                    "description": "Whether to capture the full scrollable page. Defaults to false.",
                                    "default": False,
                                },
                            },
                            "required": [],
                        },
                    },
                },
            ),
            ToolSchema(
                schema_type=SchemaType.XML,
                schema={},
                xml_schema=XMLTagSchema(
                    tag_name="take-screenshot",
                    mappings=[
                        XMLNodeMapping(param_name="path", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="viewport_width", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="viewport_height", node_type="attribute", path=".", required=False),
                        XMLNodeMapping(param_name="full_page", node_type="attribute", path=".", required=False),
                    ],
                    example="""
        <function_calls>
        <invoke name="take_screenshot">
        <parameter name="path">/</parameter>
        </invoke>
        </function_calls>""",
                ),
            ),
        ]

        return schemas

    async def take_screenshot(
        self,
        path: str = "/",
        viewport_width: int = 1280,
        viewport_height: int = 720,
        full_page: bool = False,
    ) -> ToolResult:
        """Capture a screenshot of the live preview using headless Chromium."""
        try:
            await self._ensure_sandbox()

            # Get preview URL
            port = 8081 if self.app_type == "mobile" else 3000
            app_name = "cheatcode-mobile" if self.app_type == "mobile" else "cheatcode-app"

            try:
                preview_link = await self.sandbox.get_preview_link(port)
                preview_url = preview_link.url if hasattr(preview_link, "url") else str(preview_link)
            except Exception:
                preview_url = f"http://localhost:{port}"

            target_url = f"{preview_url}{path}" if path != "/" else preview_url
            screenshot_path = f"/workspace/{app_name}/_screenshot.png"
            full_page_js = "true" if full_page else "false"

            # Install puppeteer if needed (check first)
            check_cmd = "node -e \"require('puppeteer')\" 2>/dev/null && echo 'OK' || echo 'MISSING'"
            check_result = await self.sandbox.process.exec(command=check_cmd, cwd=f"/workspace/{app_name}", timeout=10)

            if "MISSING" in (check_result.result or ""):
                logger.info("Installing puppeteer for screenshot capture...")
                install_cmd = "npm install --no-save puppeteer 2>&1 | tail -3"
                install_result = await self.sandbox.process.exec(
                    command=install_cmd, cwd=f"/workspace/{app_name}", timeout=120
                )
                if install_result.exit_code != 0:
                    return self.fail_response(
                        f"Could not install puppeteer for screenshots: {(install_result.result or '')[:200]}"
                    )

            # Run puppeteer screenshot script
            script = f"""
const puppeteer = require('puppeteer');
(async () => {{
  const browser = await puppeteer.launch({{
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }});
  const page = await browser.newPage();
  await page.setViewport({{ width: {viewport_width}, height: {viewport_height} }});
  try {{
    await page.goto('{target_url}', {{ waitUntil: 'networkidle2', timeout: 15000 }});
  }} catch (e) {{
    // Try with shorter timeout
    await page.goto('{target_url}', {{ waitUntil: 'domcontentloaded', timeout: 10000 }});
    await new Promise(r => setTimeout(r, 2000));
  }}
  await page.screenshot({{ path: '{screenshot_path}', fullPage: {full_page_js} }});
  await browser.close();
  console.log('SCREENSHOT_OK');
}})();
"""
            # Write script and execute
            script_path = f"/workspace/{app_name}/_take_screenshot.js"
            await self.sandbox.fs.upload_file(script.encode(), script_path)

            result = await self.sandbox.process.exec(
                command=f"node {script_path}",
                cwd=f"/workspace/{app_name}",
                timeout=30,
            )

            if "SCREENSHOT_OK" not in (result.result or ""):
                return self.fail_response(f"Screenshot capture failed: {(result.result or 'no output')[:300]}")

            # Download and compress the screenshot
            try:
                screenshot_bytes = await self.sandbox.fs.download_file(screenshot_path)
            except Exception as e:
                return self.fail_response(f"Could not read screenshot file: {e!s}")

            # Compress image (reuse pattern from SandboxVisionTool)
            compressed_bytes, mime_type = self._compress_image(screenshot_bytes)

            if len(compressed_bytes) > MAX_COMPRESSED_SIZE:
                return self.fail_response("Screenshot too large even after compression.")

            # Store as image_context message for next-turn analysis
            base64_image = base64.b64encode(compressed_bytes).decode("utf-8")
            image_context_data = {
                "mime_type": mime_type,
                "base64": base64_image,
                "file_path": f"screenshot:{path}",
                "original_size": len(screenshot_bytes),
                "compressed_size": len(compressed_bytes),
            }

            await self.thread_manager.add_message(
                thread_id=self.thread_id,
                type="image_context",
                content=image_context_data,
                is_llm_message=False,
            )

            # Cleanup temp files
            try:
                await self.sandbox.fs.delete_file(screenshot_path)
                await self.sandbox.fs.delete_file(script_path)
            except Exception:
                pass

            return self.success_response(
                f"Screenshot captured for path '{path}' ({viewport_width}x{viewport_height}). "
                f"Size: {len(compressed_bytes) / 1024:.1f}KB. "
                f"The image will be visible in the next turn for analysis."
            )

        except Exception as e:
            logger.error(f"Error taking screenshot: {e!s}", exc_info=True)
            return self.fail_response(f"Error taking screenshot: {e!s}")

    def _compress_image(self, image_bytes: bytes) -> tuple[bytes, str]:
        """Compress a PNG screenshot to reduce size."""
        try:
            from io import BytesIO

            from PIL import Image

            img = Image.open(BytesIO(image_bytes))

            # Resize if too large
            width, height = img.size
            if width > DEFAULT_MAX_WIDTH or height > DEFAULT_MAX_HEIGHT:
                ratio = min(DEFAULT_MAX_WIDTH / width, DEFAULT_MAX_HEIGHT / height)
                img = img.resize((int(width * ratio), int(height * ratio)), Image.Resampling.LANCZOS)

            # Convert to RGB and save as JPEG for compression
            if img.mode in ("RGBA", "LA", "P"):
                background = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
                img = background

            output = BytesIO()
            img.save(output, format="JPEG", quality=DEFAULT_JPEG_QUALITY, optimize=True)
            return output.getvalue(), "image/jpeg"

        except Exception:
            # If PIL not available, return original
            return image_bytes, "image/png"
