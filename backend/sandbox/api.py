import os
import re
import urllib.parse
from typing import Optional
import time
import asyncio

from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Form, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel
from daytona import AsyncSandbox
import mimetypes

from sandbox.sandbox import get_or_start_sandbox, get_sandbox, delete_sandbox
from utils.logger import logger
from utils.auth_utils import get_optional_user_id
from services.supabase import DBConnection

# Preview proxy URL - removes Daytona warning page
PREVIEW_PROXY_URL = os.environ.get('PREVIEW_PROXY_URL', 'https://preview.trycheatcode.com')

# Initialize shared resources
router = APIRouter(tags=["sandbox"])
db = None

def initialize(_db: DBConnection):
    """Initialize the sandbox API with resources from the main API."""
    global db
    db = _db
    logger.info("Initialized sandbox API with database connection")

def is_image_file(file: UploadFile) -> bool:
    """Check if the uploaded file is an image based on MIME type and filename"""
    # Check MIME type first (most reliable)
    if file.content_type and file.content_type.startswith('image/'):
        return True
    
    # Check file extension as fallback
    if file.filename:
        filename_lower = file.filename.lower()
        image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif']
        if any(filename_lower.endswith(ext) for ext in image_extensions):
            return True
            
        # Also check using mimetypes module
        mime_type, _ = mimetypes.guess_type(file.filename)
        if mime_type and mime_type.startswith('image/'):
            return True
    
    return False

class FileInfo(BaseModel):
    """Model for file information"""
    name: str
    path: str
    is_dir: bool
    size: int
    mod_time: str
    permissions: Optional[str] = None

def normalize_path(path: str) -> str:
    """
    Normalize a path to ensure proper UTF-8 encoding and handling.
    
    Args:
        path: The file path, potentially containing URL-encoded characters
        
    Returns:
        Normalized path with proper UTF-8 encoding
    """
    try:
        # First, ensure the path is properly URL-decoded
        decoded_path = urllib.parse.unquote(path)
        
        # Handle Unicode escape sequences like \u0308
        try:
            # Replace Python-style Unicode escapes (\u0308) with actual characters
            # This handles cases where the Unicode escape sequence is part of the URL
            import re
            unicode_pattern = re.compile(r'\\u([0-9a-fA-F]{4})')
            
            def replace_unicode(match):
                hex_val = match.group(1)
                return chr(int(hex_val, 16))
            
            decoded_path = unicode_pattern.sub(replace_unicode, decoded_path)
        except Exception as unicode_err:
            logger.warning(f"Error processing Unicode escapes in path '{path}': {str(unicode_err)}")
        
        logger.debug(f"Normalized path from '{path}' to '{decoded_path}'")
        return decoded_path
    except Exception as e:
        logger.error(f"Error normalizing path '{path}': {str(e)}")
        return path  # Return original path if decoding fails

async def verify_sandbox_access(client, sandbox_id: str, user_id: Optional[str] = None):
    """
    Verify that a user has access to a specific sandbox based on account membership.
    
    Args:
        client: The Supabase client
        sandbox_id: The sandbox ID to check access for
        user_id: The user ID to check permissions for. Can be None for public resource access.
        
    Returns:
        dict: Project data containing sandbox information
        
    Raises:
        HTTPException: If the user doesn't have access to the sandbox or sandbox doesn't exist
    """
    # Find the project that owns this sandbox
    project_result = await client.table('projects').select('*').filter('sandbox->>id', 'eq', sandbox_id).execute()
    
    if not project_result.data or len(project_result.data) == 0:
        raise HTTPException(status_code=404, detail="Sandbox not found")
    
    project_data = project_result.data[0]

    if project_data.get('is_public'):
        return project_data
    
    # For private projects, we must have a user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required for this resource")
    
    project_user_id = project_data.get('user_id')

    # Verify ownership - check if the authenticated user matches the project owner
    if project_user_id:
        # Get the account_id for the authenticated Clerk user
        account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': user_id}).execute()
        if account_result.data and account_result.data == project_user_id:
            return project_data

    raise HTTPException(status_code=403, detail="Not authorized to access this sandbox")

async def get_sandbox_by_id_safely(client, sandbox_id: str, start_if_stopped: bool = True) -> AsyncSandbox:
    """
    Safely retrieve a sandbox object by its ID, using the project that owns it.

    Args:
        client: The Supabase client
        sandbox_id: The sandbox ID to retrieve
        start_if_stopped: If True (default), will acquire lock and start sandbox if stopped.
                          If False, retrieves sandbox without locking (read-only, faster).

    Returns:
        AsyncSandbox: The sandbox object

    Raises:
        HTTPException: If the sandbox doesn't exist or can't be retrieved
    """
    # Find the project that owns this sandbox
    project_result = await client.table('projects').select('project_id').filter('sandbox->>id', 'eq', sandbox_id).execute()

    if not project_result.data or len(project_result.data) == 0:
        logger.error(f"No project found for sandbox ID: {sandbox_id}")
        raise HTTPException(status_code=404, detail="Sandbox not found - no project owns this sandbox ID")

    try:
        if start_if_stopped:
            # Use locking version - will start sandbox if stopped
            sandbox = await get_or_start_sandbox(sandbox_id)
        else:
            # Use non-locking version - read-only, won't start sandbox
            sandbox = await get_sandbox(sandbox_id)

        return sandbox
    except Exception as e:
        logger.error(f"Error retrieving sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve sandbox: {str(e)}")

@router.post("/sandboxes/{sandbox_id}/files")
async def create_file(
    sandbox_id: str, 
    path: str = Form(...),
    file: UploadFile = File(...),
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """Create a file in the sandbox using direct file upload"""
    # Validate that the uploaded file is an image
    if not is_image_file(file):
        raise HTTPException(
            status_code=400, 
            detail=f"Only image files are allowed. Received file: {file.filename} with content type: {file.content_type}"
        )
    
    # Normalize the path to handle UTF-8 encoding correctly
    path = normalize_path(path)
    
    logger.info(f"Received file upload request for sandbox {sandbox_id}, path: {path}, user_id: {user_id}")
    client = await db.client
    
    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)
    
    try:
        # Get sandbox using the safer method
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id)
        
        # Read file content directly from the uploaded file
        content = await file.read()
        
        # Create file using raw binary content
        await sandbox.fs.upload_file(content, path)
        logger.info(f"File created at {path} in sandbox {sandbox_id}")
        
        return {"status": "success", "created": True, "path": path}
    except Exception as e:
        logger.error(f"Error creating file in sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sandboxes/{sandbox_id}/files")
async def list_files(
    sandbox_id: str, 
    path: str,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """List files and directories at the specified path"""
    # Normalize the path to handle UTF-8 encoding correctly
    path = normalize_path(path)
    
    logger.info(f"Received list files request for sandbox {sandbox_id}, path: {path}, user_id: {user_id}")
    client = await db.client
    
    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)
    
    try:
        # Get sandbox using the safer method
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id)
        
        # List files
        files = await sandbox.fs.list_files(path)
        result = []
        
        for file in files:
            # Convert file information to our model
            # Ensure forward slashes are used for paths, regardless of OS
            full_path = f"{path.rstrip('/')}/{file.name}" if path != '/' else f"/{file.name}"
            file_info = FileInfo(
                name=file.name,
                path=full_path, # Use the constructed path
                is_dir=file.is_dir,
                size=file.size,
                mod_time=str(file.mod_time),
                permissions=getattr(file, 'permissions', None)
            )
            result.append(file_info)
        
        logger.info(f"Successfully listed {len(result)} files in sandbox {sandbox_id}")
        return {"files": [file.dict() for file in result]}
    except Exception as e:
        logger.error(f"Error listing files in sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Default directories to exclude from file tree
DEFAULT_EXCLUDED_DIRS = {
    # Package managers and dependencies
    'node_modules', 'bower_components', 'vendor', '.pnpm', 'jspm_packages',
    # Build outputs and caches
    '.next', 'dist', 'build', 'out', '.cache', '.parcel-cache', '.turbo',
    '.nuxt', '.output', '.svelte-kit', '.vercel', '.netlify',
    # IDE and editor directories
    '.vscode', '.idea', '.vs', '.settings', '.project',
    # Version control
    '.git', '.svn', '.hg', '.bzr',
    # Testing and coverage
    'coverage', '.nyc_output', '.jest', 'jest-coverage', '__snapshots__',
    # Temporary and log directories
    'tmp', 'temp', 'logs', 'log', '.temp', '.tmp',
    # OS generated
    '.DS_Store', 'Thumbs.db', '__MACOSX',
    # Other common build/cache directories
    '.gradle', '.mvn', 'target', 'bin', 'obj', '.terraform',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
    '.expo', '.expo-shared', 'android', 'ios',  # React Native build dirs
}

# File extensions to include in the tree
INCLUDED_EXTENSIONS = {
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',  # JavaScript/TypeScript
    'json', 'jsonc',  # Config
    'css', 'scss', 'sass', 'less', 'styl',  # Styles
    'html', 'htm', 'xml', 'svg',  # Markup
    'md', 'mdx', 'txt', 'rst',  # Documentation
    'yml', 'yaml', 'toml', 'ini', 'env',  # Config files
    'py', 'pyi',  # Python
    'sh', 'bash', 'zsh',  # Shell scripts
    'sql',  # Database
    'graphql', 'gql',  # GraphQL
    'prisma',  # Prisma schema
}

# Important files to always include regardless of extension
IMPORTANT_FILES = {
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'next.config.js', 'next.config.ts', 'next.config.mjs',
    'tailwind.config.js', 'tailwind.config.ts',
    'tsconfig.json', 'jsconfig.json',
    'vite.config.js', 'vite.config.ts',
    'webpack.config.js', 'rollup.config.js',
    '.gitignore', '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc',
    'README.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml',
    'Makefile', 'Procfile',
    'app.json', 'expo.json',  # React Native
}


def build_tree_from_paths(file_paths: list, base_path: str) -> list:
    """
    Convert a flat list of file paths into a nested tree structure.

    Args:
        file_paths: List of absolute file paths
        base_path: The base path to strip from paths (e.g., /workspace/cheatcode-app)

    Returns:
        List of tree nodes with nested children
    """
    tree = {}
    base_path = base_path.rstrip('/')

    for full_path in file_paths:
        # Get relative path
        if full_path.startswith(base_path + '/'):
            relative_path = full_path[len(base_path) + 1:]
        elif full_path.startswith(base_path):
            relative_path = full_path[len(base_path):]
        else:
            relative_path = full_path

        if not relative_path:
            continue

        parts = relative_path.split('/')
        current = tree

        # Build nested dictionary structure
        for i, part in enumerate(parts):
            if not part:
                continue
            if part not in current:
                is_file = (i == len(parts) - 1)
                current[part] = {
                    '_name': part,
                    '_path': '/'.join(parts[:i+1]),
                    '_full_path': f"{base_path}/{'/'.join(parts[:i+1])}",
                    '_is_file': is_file,
                    '_children': {} if not is_file else None
                }
            if current[part]['_children'] is not None:
                current = current[part]['_children']

    def dict_to_list(d: dict) -> list:
        """Convert nested dict to list format with children arrays"""
        result = []
        for key, value in d.items():
            if key.startswith('_'):
                continue
            node = {
                'name': value['_name'],
                'path': value['_path'],
                'fullPath': value['_full_path'],
                'type': 'file' if value['_is_file'] else 'directory'
            }
            if value['_children'] is not None:
                children = dict_to_list(value['_children'])
                # Sort: directories first, then files, alphabetically
                children.sort(key=lambda x: (x['type'] == 'file', x['name'].lower()))
                node['children'] = children
            result.append(node)

        # Sort: directories first, then files, alphabetically
        result.sort(key=lambda x: (x['type'] == 'file', x['name'].lower()))
        return result

    return dict_to_list(tree)


def should_include_file(file_path: str, excluded_dirs: set) -> bool:
    """
    Determine if a file should be included in the tree.

    Args:
        file_path: The file path to check
        excluded_dirs: Set of directory names to exclude

    Returns:
        True if file should be included
    """
    parts = file_path.split('/')

    # Check if any part of the path is an excluded directory
    for part in parts[:-1]:  # Exclude the filename from directory check
        if part in excluded_dirs:
            return False

    # Get the filename
    filename = parts[-1] if parts else ''
    if not filename:
        return False

    # Always include important files
    if filename in IMPORTANT_FILES:
        return True

    # Check file extension
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext in INCLUDED_EXTENSIONS:
        return True

    # Include dotfiles that are config files
    if filename.startswith('.') and ext in {'js', 'ts', 'json', 'yml', 'yaml', 'toml'}:
        return True

    return False


@router.get("/sandboxes/{sandbox_id}/files/tree")
async def get_file_tree(
    sandbox_id: str,
    path: str = None,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """
    Get complete file tree in a single API call using recursive search.

    This endpoint replaces multiple recursive list_files calls with a single
    search_files call, dramatically improving performance for large projects.

    Returns a pre-filtered, hierarchical tree structure.
    """
    logger.info(f"Received file tree request for sandbox {sandbox_id}, path: {path}, user_id: {user_id}")
    client = await db.client

    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)

    try:
        # Get project to determine app_type for default path
        if not path:
            project_result = await client.table('projects').select('app_type').filter('sandbox->>id', 'eq', sandbox_id).execute()
            if project_result.data:
                app_type = project_result.data[0].get('app_type', 'web')
                path = '/workspace/cheatcode-mobile' if app_type == 'mobile' else '/workspace/cheatcode-app'
            else:
                path = '/workspace/cheatcode-app'

        # Normalize the path
        path = normalize_path(path)

        # Get sandbox using non-locking access (read-only operation)
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id, start_if_stopped=False)

        # Use search_files with glob pattern to get ALL files recursively in ONE call
        # This is the key optimization - replaces N+1 list_files calls
        logger.info(f"Searching files recursively in {path}")

        try:
            # Try using search_files for recursive listing
            search_result = await sandbox.fs.search_files(path, "**/*")
            all_files = search_result.files if hasattr(search_result, 'files') else []
            logger.info(f"Found {len(all_files)} total files via search_files")
        except Exception as search_err:
            # Fallback: If search_files doesn't work, use optimized recursive list
            logger.warning(f"search_files failed, using fallback: {search_err}")
            all_files = await _recursive_list_files_optimized(sandbox, path)
            logger.info(f"Found {len(all_files)} total files via fallback method")

        # Filter files server-side
        filtered_files = [
            f for f in all_files
            if should_include_file(f, DEFAULT_EXCLUDED_DIRS)
        ]

        logger.info(f"Filtered to {len(filtered_files)} relevant files")

        # Build tree structure from flat file list
        tree = build_tree_from_paths(filtered_files, path)

        return {
            "tree": tree,
            "totalFiles": len(filtered_files),
            "basePath": path
        }

    except Exception as e:
        logger.error(f"Error getting file tree for sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def _recursive_list_files_optimized(sandbox, base_path: str, max_depth: int = 10) -> list:
    """
    Fallback recursive file listing with parallel directory fetching.
    Used when search_files is not available.
    """
    all_files = []

    async def fetch_directory(dir_path: str, depth: int) -> list:
        if depth > max_depth:
            return []

        try:
            files = await sandbox.fs.list_files(dir_path)
            result = []
            subdirs = []

            for file in files:
                # Construct full path (Daytona FileInfo only has 'name', not 'path')
                full_path = f"{dir_path.rstrip('/')}/{file.name}"

                # Skip excluded directories early
                if file.is_dir:
                    if file.name in DEFAULT_EXCLUDED_DIRS:
                        continue
                    subdirs.append(full_path)
                else:
                    result.append(full_path)

            # Fetch subdirectories in parallel (key optimization)
            if subdirs:
                subdir_tasks = [fetch_directory(subdir, depth + 1) for subdir in subdirs]
                subdir_results = await asyncio.gather(*subdir_tasks, return_exceptions=True)

                for subdir_result in subdir_results:
                    if isinstance(subdir_result, list):
                        result.extend(subdir_result)

            return result

        except Exception as e:
            logger.warning(f"Error listing directory {dir_path}: {e}")
            return []

    all_files = await fetch_directory(base_path, 0)
    return all_files


@router.get("/sandboxes/{sandbox_id}/files/content")
async def read_file(
    sandbox_id: str, 
    path: str,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """Read a file from the sandbox"""
    # Normalize the path to handle UTF-8 encoding correctly
    original_path = path
    path = normalize_path(path)
    
    logger.info(f"Received file read request for sandbox {sandbox_id}, path: {path}, user_id: {user_id}")
    if original_path != path:
        logger.info(f"Normalized path from '{original_path}' to '{path}'")
    
    client = await db.client
    
    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)
    
    try:
        # Get sandbox using non-locking access - file read is read-only
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id, start_if_stopped=False)

        # Read file directly - don't check existence first with a separate call
        try:
            content = await sandbox.fs.download_file(path)
        except Exception as download_err:
            logger.error(f"Error downloading file {path} from sandbox {sandbox_id}: {str(download_err)}")
            raise HTTPException(
                status_code=404, 
                detail=f"Failed to download file: {str(download_err)}"
            )
        
        # Return a Response object with the content directly
        filename = os.path.basename(path)
        logger.info(f"Successfully read file {filename} from sandbox {sandbox_id}")
        
        # Ensure proper encoding by explicitly using UTF-8 for the filename in Content-Disposition header
        # This applies RFC 5987 encoding for the filename to support non-ASCII characters
        encoded_filename = filename.encode('utf-8').decode('latin-1')
        content_disposition = f"attachment; filename*=UTF-8''{encoded_filename}"
        
        return Response(
            content=content,
            media_type="application/octet-stream",
            headers={"Content-Disposition": content_disposition}
        )
    except HTTPException:
        # Re-raise HTTP exceptions without wrapping
        raise
    except Exception as e:
        logger.error(f"Error reading file in sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sandboxes/{sandbox_id}/download-archive")
async def download_archive(
    sandbox_id: str,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """
    Download project code as a ZIP archive.

    This endpoint creates a tar.gz archive server-side in the sandbox,
    downloads it, then converts it to ZIP format before sending to the client.
    This is much faster than downloading each file individually.
    """
    from fastapi.responses import StreamingResponse
    import io
    import tarfile
    import zipfile

    logger.info(f"Received download archive request for sandbox {sandbox_id}, user_id: {user_id}")
    client = await db.client

    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)

    try:
        # Get project to determine app_type and project name
        project_result = await client.table('projects').select('app_type, name').filter('sandbox->>id', 'eq', sandbox_id).execute()
        if not project_result.data:
            raise HTTPException(status_code=404, detail="Project not found for sandbox")

        app_type = project_result.data[0].get('app_type', 'web')
        project_name = project_result.data[0].get('name', 'project')

        # Determine workspace path
        workspace_dir = 'cheatcode-mobile' if app_type == 'mobile' else 'cheatcode-app'
        archive_path = f'/tmp/{workspace_dir}-code.tar.gz'

        # Get sandbox (non-locking for read operations)
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id, start_if_stopped=False)

        # Create archive server-side using tar command (universally available)
        exclude_patterns = [
            'node_modules', '.next', '.git', 'dist', 'build', '.cache',
            '__pycache__', '.pytest_cache', 'coverage', '.turbo', '.expo',
            'android', 'ios', '.gradle', 'target', 'vendor', 'bower_components'
        ]
        exclude_args = ' '.join([f'--exclude="{p}"' for p in exclude_patterns])

        tar_command = f'cd /workspace && tar {exclude_args} -czf {archive_path} {workspace_dir}'

        logger.info(f"Creating tar archive in sandbox")
        start_time = time.time()

        # Execute tar command
        tar_result = await sandbox.process.exec(tar_command, timeout=120)

        if tar_result.exit_code != 0:
            error_msg = tar_result.result if hasattr(tar_result, 'result') else 'Unknown error'
            logger.error(f"Failed to create archive: {error_msg}")
            raise HTTPException(status_code=500, detail=f"Failed to create archive: {error_msg}")

        tar_time = time.time() - start_time
        logger.info(f"Tar archive created in {tar_time:.2f}s")

        # Download the tar.gz file
        download_start = time.time()
        tar_content = await sandbox.fs.download_file(archive_path)
        download_time = time.time() - download_start
        logger.info(f"Tar archive downloaded in {download_time:.2f}s, size: {len(tar_content)} bytes")

        # Clean up the temporary archive file in sandbox
        try:
            await sandbox.process.exec(f'rm -f {archive_path}', timeout=10)
        except Exception as cleanup_err:
            logger.warning(f"Failed to cleanup archive file: {cleanup_err}")

        # Convert tar.gz to ZIP in memory
        convert_start = time.time()
        zip_buffer = io.BytesIO()

        with tarfile.open(fileobj=io.BytesIO(tar_content), mode='r:gz') as tar:
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                for member in tar.getmembers():
                    if member.isfile():
                        file_data = tar.extractfile(member)
                        if file_data:
                            zf.writestr(member.name, file_data.read())
                    elif member.isdir():
                        # Create directory entry in zip
                        zf.writestr(member.name + '/', '')

        zip_content = zip_buffer.getvalue()
        convert_time = time.time() - convert_start
        logger.info(f"Converted to ZIP in {convert_time:.2f}s, size: {len(zip_content)} bytes")

        # Sanitize project name for filename
        safe_name = "".join(c if c.isalnum() or c in '-_' else '_' for c in project_name)
        filename = f"{safe_name}-code.zip"

        total_time = time.time() - start_time
        logger.info(f"Total archive download completed in {total_time:.2f}s")

        # Stream the ZIP to the client
        return StreamingResponse(
            io.BytesIO(zip_content),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(zip_content)),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading archive for sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sandboxes/{sandbox_id}/files")
async def delete_file(
    sandbox_id: str, 
    path: str,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """Delete a file from the sandbox"""
    # Normalize the path to handle UTF-8 encoding correctly
    path = normalize_path(path)
    
    logger.info(f"Received file delete request for sandbox {sandbox_id}, path: {path}, user_id: {user_id}")
    client = await db.client
    
    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)
    
    try:
        # Get sandbox using the safer method
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id)
        
        # Delete file
        await sandbox.fs.delete_file(path)
        logger.info(f"File deleted at {path} in sandbox {sandbox_id}")
        
        return {"status": "success", "deleted": True, "path": path}
    except Exception as e:
        logger.error(f"Error deleting file in sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/sandboxes/{sandbox_id}")
async def delete_sandbox_route(
    sandbox_id: str,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """Delete an entire sandbox"""
    logger.info(f"Received sandbox delete request for sandbox {sandbox_id}, user_id: {user_id}")
    client = await db.client
    
    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)
    
    try:
        # Delete the sandbox using the sandbox module function
        await delete_sandbox(sandbox_id)
        
        return {"status": "success", "deleted": True, "sandbox_id": sandbox_id}
    except Exception as e:
        logger.error(f"Error deleting sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Should happen on server-side fully
@router.post("/project/{project_id}/sandbox/ensure-active")
async def ensure_project_sandbox_active(
    project_id: str,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """
    Ensure that a project's sandbox is active and running.
    Checks the sandbox status and starts it if it's not running.
    """
    logger.info(f"Received ensure sandbox active request for project {project_id}, user_id: {user_id}")
    client = await db.client
    
    # Find the project and sandbox information
    project_result = await client.table('projects').select('*').eq('project_id', project_id).execute()
    
    if not project_result.data or len(project_result.data) == 0:
        logger.error(f"Project not found: {project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    
    project_data = project_result.data[0]
    
    # For public projects, no authentication is needed
    if not project_data.get('is_public'):
        # For private projects, we must have a user_id
        if not user_id:
            logger.error(f"Authentication required for private project {project_id}")
            raise HTTPException(status_code=401, detail="Authentication required for this resource")
            
        project_user_id = project_data.get('user_id')

        # Verify ownership - check if the authenticated user matches the project owner
        if project_user_id:
            # Get the account_id for the authenticated Clerk user
            account_result = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': user_id}).execute()
            if not (account_result.data and account_result.data == project_user_id):
                logger.error(f"User {user_id} not authorized to access project {project_id}")
                raise HTTPException(status_code=403, detail="Not authorized to access this project")
    
    try:
        # Get sandbox ID from project data
        sandbox_info = project_data.get('sandbox', {})
        if not sandbox_info.get('id'):
            raise HTTPException(status_code=404, detail="No sandbox found for this project")
            
        sandbox_id = sandbox_info['id']
        
        # Get or start the sandbox
        logger.info(f"Ensuring sandbox is active for project {project_id}")
        sandbox = await get_or_start_sandbox(sandbox_id)
        
        logger.info(f"Successfully ensured sandbox {sandbox_id} is active for project {project_id}")
        
        return {
            "status": "success", 
            "sandbox_id": sandbox_id,
            "message": "Sandbox is active"
        }
    except Exception as e:
        logger.error(f"Error ensuring sandbox is active for project {project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sandboxes/{sandbox_id}/execute")
async def execute_command(
    sandbox_id: str,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """Execute a command in the sandbox using Daytona SDK"""
    logger.info(f"Received command execution request for sandbox {sandbox_id}, user_id: {user_id}")
    client = await db.client
    
    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)
    
    try:
        # Parse request body
        body = await request.json()
        command = body.get('command')
        timeout = body.get('timeout', 60)
        blocking = body.get('blocking', True)
        session_name = body.get('session_name')
        
        # Get project to determine app_type for default cwd
        default_cwd = '/workspace/cheatcode-app'  # fallback
        try:
            # Try JSON field query first (correct syntax: ->> for text extraction)
            project_result = await client.table('projects').select('app_type, sandbox').filter('sandbox->>id', 'eq', sandbox_id).execute()
            if project_result.data:
                app_type = project_result.data[0].get('app_type', 'web')
                default_cwd = '/workspace/cheatcode-mobile' if app_type == 'mobile' else '/workspace/cheatcode-app'
                logger.debug(f"Using default cwd {default_cwd} for app_type: {app_type}")
                logger.info(f"Successfully found project with app_type: {app_type} for sandbox: {sandbox_id}")
            else:
                # Fallback: get all projects and filter in Python
                logger.warning(f"JSON query failed, trying fallback method for sandbox {sandbox_id}")
                all_projects = await client.table('projects').select('app_type, sandbox').execute()
                matching_project = None
                for project in all_projects.data or []:
                    sandbox_data = project.get('sandbox', {})
                    if isinstance(sandbox_data, dict) and sandbox_data.get('id') == sandbox_id:
                        matching_project = project
                        break
                
                if matching_project:
                    app_type = matching_project.get('app_type', 'web')
                    default_cwd = '/workspace/cheatcode-mobile' if app_type == 'mobile' else '/workspace/cheatcode-app'
                    logger.info(f"Fallback query found project with app_type: {app_type} for sandbox: {sandbox_id}")
                else:
                    logger.warning(f"No project found for sandbox {sandbox_id} even with fallback, using web default")
        except Exception as e:
            logger.warning(f"Could not determine app_type for sandbox {sandbox_id}, using web default: {e}")
        
        cwd = body.get('cwd', default_cwd)

        if not command:
            raise HTTPException(status_code=400, detail="Command is required")

        # For blocking commands (status checks), use non-locking access
        # since if sandbox isn't running, the command will fail anyway.
        # For non-blocking commands (dev server start), use locking access
        # because we need to ensure the sandbox is started.
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id, start_if_stopped=not blocking)

        if blocking:
            # Execute command synchronously
            response = await sandbox.process.exec(
                command=command,
                cwd=cwd,
                timeout=timeout
            )
            
            return {
                "output": response.result,
                "exit_code": response.exit_code,
                "success": response.exit_code == 0,
                "blocking": True
            }
        else:
            # Execute command in background session
            if not session_name:
                session_name = f"session_{sandbox_id}_{int(time.time())}"
            
            # Attempt to fetch the session; if the sandbox is still booting we
            # may get a "Sandbox is not running" error. In that case wait a
            # few seconds and retry once before giving up.
            try:
                await sandbox.process.get_session(session_name)
                logger.info(f"Session '{session_name}' already exists – reusing it")
            except Exception as e:
                if "Sandbox is not running" in str(e):
                    logger.warning("Sandbox not fully running yet. Waiting 3s and retrying get_session()")
                    await asyncio.sleep(3)
                    try:
                        await sandbox.process.get_session(session_name)
                        logger.info(f"Session '{session_name}' available after retry")
                    except Exception:
                        logger.info(f"Session '{session_name}' not found after retry – creating new session")
                        await sandbox.process.create_session(session_name)
                else:
                    logger.info(f"Session '{session_name}' not found – creating a new one")
                    await sandbox.process.create_session(session_name)
            
            # Execute command in session
            from daytona import SessionExecuteRequest
            req = SessionExecuteRequest(
                command=command,
                var_async=True,
                cwd=cwd
            )
            
            response = await sandbox.process.execute_session_command(
                session_id=session_name,
                req=req
            )
            
            return {
                "session_name": session_name,
                "command_id": response.cmd_id,
                "message": f"Command started in session '{session_name}'",
                "blocking": False
            }
            
    except Exception as e:
        logger.error(f"Error executing command in sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sandboxes/{sandbox_id}/sessions/{session_name}/status")
async def get_session_status(
    sandbox_id: str,
    session_name: str,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """Get the status and output of a session"""
    logger.info(f"Received session status request for sandbox {sandbox_id}, session {session_name}, user_id: {user_id}")
    client = await db.client

    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)

    try:
        # Get sandbox using non-locking access - session status is read-only
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id, start_if_stopped=False)
        
        # Get session information
        session = await sandbox.process.get_session(session_name)
        
        # Get logs for all commands in the session
        commands_info = []
        for command in session.commands:
            try:
                logs = await sandbox.process.get_session_command_logs(
                    session_id=session_name,
                    command_id=command.id
                )
                commands_info.append({
                    "command": command.command,
                    "exit_code": command.exit_code,
                    "logs": logs
                })
            except Exception as e:
                commands_info.append({
                    "command": command.command,
                    "exit_code": command.exit_code,
                    "error": f"Failed to get logs: {str(e)}"
                })
        
        return {
            "session_name": session_name,
            "commands": commands_info,
            "total_commands": len(session.commands)
        }
        
    except Exception as e:
        logger.error(f"Error getting session status for sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sandboxes/{sandbox_id}/preview-url")
async def get_sandbox_preview_url(
    sandbox_id: str,
    request: Request = None,
    user_id: Optional[str] = Depends(get_optional_user_id)
):
    """Get the Daytona preview URL for a sandbox's dev server (port based on app_type)"""
    logger.info(f"Received preview URL request for sandbox {sandbox_id}, user_id: {user_id}")
    client = await db.client
    
    # Verify the user has access to this sandbox
    await verify_sandbox_access(client, sandbox_id, user_id)
    
    try:
        # Get project to determine app_type
        project_result = await client.table('projects').select('app_type').filter('sandbox->>id', 'eq', sandbox_id).execute()
        if not project_result.data:
            logger.error(f"No project found for sandbox {sandbox_id}")
            raise HTTPException(status_code=404, detail="Project not found for sandbox")
        
        app_type = project_result.data[0].get('app_type', 'web')
        
        # Determine port based on app_type
        port = 8081 if app_type == 'mobile' else 3000
        service_name = "Expo Metro bundler" if app_type == 'mobile' else "Next.js dev server"
        
        logger.info(f"Using port {port} ({service_name}) for app_type: {app_type}")

        # Get sandbox using non-locking access - preview URL check is read-only
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id, start_if_stopped=False)

        # Get the Daytona preview link for the appropriate port
        try:
            preview_info = await sandbox.get_preview_link(port)
            daytona_url = preview_info.url if hasattr(preview_info, 'url') else str(preview_info)

            # Transform Daytona URL to use our proxy (removes warning page)
            # Original: https://3000-abc123-def456.proxy.daytona.works/
            # Proxied:  https://preview-proxy.../3000-abc123-def456/
            proxy_url = daytona_url
            if PREVIEW_PROXY_URL:
                match = re.match(r'https?://(\d+-[a-f0-9-]+)\.proxy\.daytona\.works(/.*)?', daytona_url, re.IGNORECASE)
                if match:
                    port_sandbox = match.group(1)  # e.g., "3000-abc123-def456"
                    path = match.group(2) or '/'
                    proxy_url = f"{PREVIEW_PROXY_URL}/{port_sandbox}{path}"
                    logger.info(f"Transformed preview URL: {daytona_url} -> {proxy_url}")

            return {
                "preview_url": proxy_url,
                "status": "available"
            }
            
        except Exception as preview_error:
            logger.error(f"Could not get preview link for sandbox {sandbox_id} on port {port}: {str(preview_error)}")

            # Try to check if dev server is running on the correct port
            try:
                health_check = await sandbox.process.exec(f"curl -s http://localhost:{port} -o /dev/null -w '%{{http_code}}' || echo '000'", timeout=10)
                # ExecuteResponse uses 'result' for output - handle None case
                http_code = (health_check.result or '').strip() if hasattr(health_check, 'result') else '000'
                if http_code == '000' or not http_code:
                    return {
                        "preview_url": None,
                        "status": "dev_server_not_running"
                    }
                else:
                    return {
                        "preview_url": None,
                        "status": "preview_not_available"
                    }
            except Exception as health_error:
                logger.warning(f"Health check failed for sandbox {sandbox_id}: {health_error}")
                return {
                    "preview_url": None,
                    "status": "error"
                }
                
    except Exception as e:
        logger.error(f"Error getting preview URL for sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting preview URL: {str(e)}")


# Complex proxy endpoint removed - replaced with simple preview URL endpoint above


@router.get("/sandboxes/{sandbox_id}/dev-server/stream")
async def stream_dev_server_status(
    sandbox_id: str,
    request: Request,
    user_id: str = Depends(get_optional_user_id),
    session_name: str = "dev_server_web",
    app_type: str = "web"
):
    """
    Stream dev server status using Server-Sent Events (SSE).

    Uses Daytona's real-time log streaming to detect when dev server is ready,
    eliminating the need for polling. Emits events:
    - status: 'starting', 'running', 'stopped', 'error'
    - logs: Real-time log chunks (optional, for debugging)
    """
    from fastapi.responses import StreamingResponse
    import json

    logger.info(f"SSE stream requested for sandbox {sandbox_id}, session {session_name}, app_type {app_type}")

    async def event_generator():
        """Generate SSE events for dev server status."""
        try:
            client = await db.client
            # Use non-locking access for SSE stream - this is read-only
            sandbox = await get_sandbox_by_id_safely(client, sandbox_id, start_if_stopped=False)

            if not sandbox:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Sandbox not found'})}\n\n"
                return

            # Determine which patterns indicate the dev server is ready
            if app_type == 'mobile':
                ready_patterns = ['Metro waiting on', 'Tunnel ready', 'Your app is ready', '8081']
                port = 8081
            else:
                ready_patterns = ['ready', 'Local:', '3000', 'started server']
                port = 3000

            # Send initial status
            yield f"data: {json.dumps({'type': 'status', 'status': 'checking'})}\n\n"

            # Check if session exists
            try:
                session = await sandbox.process.get_session(session_name)

                if not session.commands:
                    yield f"data: {json.dumps({'type': 'status', 'status': 'stopped', 'message': 'No commands in session'})}\n\n"
                    return

                # Get the latest command (dev server start command)
                latest_command = session.commands[-1] if session.commands else None

                if not latest_command:
                    yield f"data: {json.dumps({'type': 'status', 'status': 'stopped'})}\n\n"
                    return

                yield f"data: {json.dumps({'type': 'status', 'status': 'starting'})}\n\n"

                # Stream logs using Daytona's async log streaming
                server_ready = False
                log_buffer = []

                async def on_log_chunk(chunk: str):
                    """Callback for real-time log chunks."""
                    nonlocal server_ready, log_buffer
                    log_buffer.append(chunk)

                    # Check if any ready pattern is in the logs
                    combined_logs = ''.join(log_buffer)
                    for pattern in ready_patterns:
                        if pattern.lower() in combined_logs.lower():
                            server_ready = True
                            break

                # Start streaming logs asynchronously
                try:
                    # Get the command ID - Command object has 'id' field, not 'cmd_id'
                    command_id = getattr(latest_command, 'id', None) or getattr(latest_command, 'cmd_id', None)
                    if not command_id:
                        logger.warning(f"Could not get command ID from latest command: {latest_command}")
                        yield f"data: {json.dumps({'type': 'error', 'message': 'Could not get command ID'})}\n\n"
                        return

                    # Use asyncio.wait_for to add a timeout
                    log_task = asyncio.create_task(
                        sandbox.process.get_session_command_logs_async(
                            session_id=session_name,
                            command_id=command_id,
                            on_logs=on_log_chunk
                        )
                    )

                    # Poll for ready state with short intervals
                    check_count = 0
                    max_checks = 60  # 60 seconds max

                    while check_count < max_checks:
                        if server_ready:
                            yield f"data: {json.dumps({'type': 'status', 'status': 'running'})}\n\n"

                            # Also try to get preview URL
                            try:
                                preview_info = await sandbox.get_preview_link(port)
                                url = preview_info.url if hasattr(preview_info, 'url') else str(preview_info)
                                yield f"data: {json.dumps({'type': 'preview_url', 'url': url})}\n\n"
                            except Exception:
                                pass

                            break

                        # Check if client disconnected
                        if await request.is_disconnected():
                            log_task.cancel()
                            return

                        await asyncio.sleep(1)
                        check_count += 1

                        # Send heartbeat every 5 seconds
                        if check_count % 5 == 0:
                            yield f"data: {json.dumps({'type': 'heartbeat', 'elapsed': check_count})}\n\n"

                    if not server_ready:
                        # Timeout - check port directly as fallback
                        try:
                            result = await sandbox.process.exec(
                                f"curl -s -o /dev/null -w '%{{http_code}}' http://localhost:{port} 2>/dev/null || echo '000'",
                                timeout=5
                            )
                            # ExecuteResponse uses 'result' for output, not 'output'
                            http_code = (result.result or '').strip() if hasattr(result, 'result') else '000'
                            if http_code and http_code != '000':
                                yield f"data: {json.dumps({'type': 'status', 'status': 'running'})}\n\n"
                            else:
                                yield f"data: {json.dumps({'type': 'status', 'status': 'starting', 'message': 'Still starting...'})}\n\n"
                        except Exception as e:
                            logger.warning(f"Fallback port check failed: {e}")
                            yield f"data: {json.dumps({'type': 'status', 'status': 'unknown'})}\n\n"

                    log_task.cancel()

                except Exception as e:
                    logger.error(f"Error streaming logs: {e}")
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

            except Exception as session_error:
                logger.info(f"Session {session_name} not found: {session_error}")
                yield f"data: {json.dumps({'type': 'status', 'status': 'stopped', 'message': 'Session not found'})}\n\n"

        except Exception as e:
            logger.error(f"SSE stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        # Final event to signal stream end
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )
