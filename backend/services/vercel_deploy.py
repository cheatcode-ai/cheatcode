"""
Vercel Deployment Service

Provides fast, non-blocking deployments using Vercel's inline file API.
Key advantage: deploy_files() returns immediately, build happens async on Vercel.

User wait time: 5-30 seconds (file collection + API call).
"""
import httpx
import base64
import asyncio
from typing import Dict, List, Optional, Any
from utils.config import config
from utils.logger import logger

VERCEL_API_BASE = "https://api.vercel.com"

# File extensions that should be base64 encoded (binary files)
BINARY_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.pdf', '.zip', '.tar', '.gz',
    '.mp3', '.mp4', '.webm', '.ogg', '.wav',
    '.bin', '.exe', '.dll', '.so', '.dylib',
}

# Directories to exclude from deployment (saves time and space)
EXCLUDED_DIRS = {
    'node_modules', '.git', '.next', 'dist', 'build', '.cache',
    '.turbo', '.vercel', '__pycache__', '.pytest_cache',
    'coverage', '.nyc_output', '.expo', '.expo-shared',
    'android', 'ios',  # Mobile build directories
}

# Files to exclude
EXCLUDED_FILES = {
    '.DS_Store', 'Thumbs.db', '.env', '.env.local', '.env.production',
    'npm-debug.log', 'yarn-error.log', 'pnpm-debug.log',
}


class VercelDeploymentService:
    """
    Fast Vercel deployment using inline file upload (no Git required).

    Key features:
    - No Git operations needed
    - Non-blocking deploy_files() call (build happens async on Vercel)
    - Real-time status via readyState polling
    """

    def __init__(self):
        self.token = config.VERCEL_BEARER_TOKEN
        self.team_id = config.VERCEL_TEAM_ID
        if not self.token:
            raise ValueError("VERCEL_BEARER_TOKEN not configured")

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }

    def _team_params(self) -> Dict[str, str]:
        """Add team params to requests if team_id is configured."""
        return {"teamId": self.team_id} if self.team_id else {}

    async def disable_deployment_protection(self, project_id: str) -> None:
        """
        Disable SSO protection on a Vercel project to make deployments publicly accessible.

        Without this, deployments may require Vercel login to view if the team
        has default deployment protection enabled.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.patch(
                f"{VERCEL_API_BASE}/v10/projects/{project_id}",
                headers=self._headers(),
                params=self._team_params(),
                json={"ssoProtection": None}
            )
            if resp.status_code not in (200, 201):
                logger.warning(f"Failed to disable deployment protection: {resp.status_code} {resp.text}")
            else:
                logger.info(f"Disabled deployment protection for project: {project_id}")

    async def ensure_project(self, project_name: str, framework: str = "nextjs") -> Dict[str, Any]:
        """
        Create or get existing Vercel project.

        Projects must exist before deployment. This function is idempotent -
        it will return the existing project if one exists with the same name.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Check if project exists
            resp = await client.get(
                f"{VERCEL_API_BASE}/v9/projects/{project_name}",
                headers=self._headers(),
                params=self._team_params()
            )
            if resp.status_code == 200:
                logger.info(f"Found existing Vercel project: {project_name}")
                return resp.json()

            # Create new project
            logger.info(f"Creating new Vercel project: {project_name}")
            resp = await client.post(
                f"{VERCEL_API_BASE}/v10/projects",
                headers=self._headers(),
                params=self._team_params(),
                json={"name": project_name, "framework": framework}
            )
            if resp.status_code in (200, 201):
                project = resp.json()
                # Disable deployment protection for public access
                await self.disable_deployment_protection(project.get('id'))
                return project

            error_msg = f"Failed to create Vercel project: {resp.status_code} {resp.text}"
            logger.error(error_msg)
            raise Exception(error_msg)

    async def deploy_files(
        self,
        project_name: str,
        files: List[Dict[str, str]],
        target: str = "production",
        framework: str = "nextjs"
    ) -> Dict[str, Any]:
        """
        Deploy files directly to Vercel (NON-BLOCKING).

        This is the key to fast deployments! The API returns immediately with
        a deployment_id - the actual build happens asynchronously on Vercel's
        infrastructure.

        Args:
            project_name: Name of the Vercel project
            files: List of {"file": "path", "data": "content", "encoding": "utf-8|base64"}
            target: "production" or "preview"
            framework: Framework for build settings (nextjs, react, etc.)

        Returns:
            Deployment response with id, url, readyState, etc.
        """
        # Build project settings based on framework
        project_settings = {
            "framework": framework,
            "installCommand": "npm install"
        }
        if framework == "nextjs":
            project_settings["buildCommand"] = "next build"
            project_settings["outputDirectory"] = ".next"
        elif framework == "vite":
            project_settings["buildCommand"] = "vite build"
            project_settings["outputDirectory"] = "dist"

        logger.info(f"Deploying {len(files)} files to Vercel project: {project_name}")

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{VERCEL_API_BASE}/v13/deployments",
                headers=self._headers(),
                params={**self._team_params(), "forceNew": "1"},
                json={
                    "name": project_name,
                    "project": project_name,
                    "files": files,
                    "projectSettings": project_settings,
                    "target": target
                }
            )

            if resp.status_code in (200, 201):
                result = resp.json()
                logger.info(f"Vercel deployment created: {result.get('id')} -> {result.get('url')}")
                # Disable deployment protection to ensure public access (fixes existing projects too)
                project_id = result.get('projectId')
                if project_id:
                    await self.disable_deployment_protection(project_id)
                return result

            error_msg = f"Vercel deployment failed: {resp.status_code} {resp.text}"
            logger.error(error_msg)
            raise Exception(error_msg)

    async def get_deployment_status(self, deployment_id: str) -> Dict[str, Any]:
        """
        Get current deployment status from Vercel.

        readyState values:
        - QUEUED: Waiting to build
        - BUILDING: Build in progress
        - READY: Successfully deployed
        - ERROR: Build/deploy failed
        - CANCELED: Deployment was canceled
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{VERCEL_API_BASE}/v13/deployments/{deployment_id}",
                headers=self._headers(),
                params=self._team_params()
            )
            if resp.status_code == 200:
                return resp.json()

            error_msg = f"Failed to get deployment status: {resp.status_code} {resp.text}"
            logger.error(error_msg)
            raise Exception(error_msg)


async def collect_files_for_vercel(
    sandbox,
    workdir: str = "/workspace/cheatcode-app"
) -> List[Dict[str, str]]:
    """
    Collect all files from sandbox for Vercel deployment.

    Optimized approach for fastest file collection:
    1. Use search_files for single-call file listing (when available)
    2. Fall back to shell `find` command
    3. Parallel file downloads with asyncio.gather in batches
    4. Smart binary detection and base64 encoding

    Args:
        sandbox: Daytona AsyncSandbox instance
        workdir: Workspace directory path

    Returns:
        List of {"file": "relative/path", "data": "content", "encoding": "utf-8|base64"}
    """
    files = []

    # Build exclusion pattern for find command
    exclude_args = " ".join(f"-not -path '*/{d}/*'" for d in EXCLUDED_DIRS)

    # Get all files - try search_files first (single API call), fall back to find
    try:
        search_result = await sandbox.fs.search_files(workdir, "**/*")
        if hasattr(search_result, 'files'):
            all_paths = [f.path if hasattr(f, 'path') else str(f) for f in search_result.files]
        else:
            all_paths = [f.path if hasattr(f, 'path') else str(f) for f in search_result]
        logger.info(f"Got {len(all_paths)} files via search_files")
    except Exception as e:
        logger.info(f"search_files not available, using find: {e}")
        result = await sandbox.process.exec(
            f"find {workdir} -type f {exclude_args}",
            timeout=60
        )
        if hasattr(result, 'result'):
            output = result.result
        else:
            output = str(result)
        all_paths = [p.strip() for p in output.strip().split('\n') if p.strip()]
        logger.info(f"Got {len(all_paths)} files via find command")

    # Filter out excluded directories and files
    filtered_paths = []
    for path in all_paths:
        # Skip excluded directories
        if any(f"/{excluded}/" in path for excluded in EXCLUDED_DIRS):
            continue
        # Skip excluded files
        filename = path.split('/')[-1] if '/' in path else path
        if filename in EXCLUDED_FILES:
            continue
        filtered_paths.append(path)

    logger.info(f"Collecting {len(filtered_paths)} files for Vercel deployment (filtered from {len(all_paths)})")

    # Download files in parallel (batches of 50 for memory efficiency)
    async def download_file(file_path: str) -> Optional[Dict[str, str]]:
        """Download a single file and format for Vercel."""
        try:
            content = await sandbox.fs.download_file(file_path)

            # Calculate relative path
            if file_path.startswith(workdir):
                relative_path = file_path[len(workdir):].lstrip('/')
            else:
                relative_path = file_path.lstrip('/')

            # Determine if binary based on extension
            ext = ''
            if '.' in file_path:
                ext = '.' + file_path.split('.')[-1].lower()
            is_binary = ext in BINARY_EXTENSIONS

            if is_binary:
                return {
                    "file": relative_path,
                    "data": base64.b64encode(content).decode('utf-8'),
                    "encoding": "base64"
                }
            else:
                # Try UTF-8 decode, fall back to base64 for binary content
                try:
                    text_content = content.decode('utf-8')
                    return {
                        "file": relative_path,
                        "data": text_content,
                        "encoding": "utf-8"
                    }
                except UnicodeDecodeError:
                    # File is binary despite extension
                    return {
                        "file": relative_path,
                        "data": base64.b64encode(content).decode('utf-8'),
                        "encoding": "base64"
                    }
        except Exception as e:
            logger.warning(f"Skipping file {file_path}: {e}")
            return None

    # Process files in batches for memory efficiency
    BATCH_SIZE = 50
    total_batches = (len(filtered_paths) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(total_batches):
        start = batch_idx * BATCH_SIZE
        end = min(start + BATCH_SIZE, len(filtered_paths))
        batch = filtered_paths[start:end]

        # Download batch in parallel
        results = await asyncio.gather(
            *[download_file(p) for p in batch],
            return_exceptions=True
        )

        # Collect successful downloads
        for result in results:
            if isinstance(result, dict):
                files.append(result)
            elif isinstance(result, Exception):
                logger.warning(f"Batch download error: {result}")

    logger.info(f"Successfully collected {len(files)} files for deployment")
    return files
