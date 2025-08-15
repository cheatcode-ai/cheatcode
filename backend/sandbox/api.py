import os
import urllib.parse
from typing import Optional
import time
import asyncio

from fastapi import FastAPI, UploadFile, File, HTTPException, APIRouter, Form, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel
from daytona_sdk import AsyncSandbox
import mimetypes

from sandbox.sandbox import get_or_start_sandbox, delete_sandbox
from utils.logger import logger
from utils.auth_utils import get_optional_user_id
from services.supabase import DBConnection

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
    
    account_id = project_data.get('account_id')
    
    # Verify account ownership (simplified for personal accounts only)
    if account_id:
        # Check if the user is the primary owner of this account
        account_result = await client.schema('basejump').from_('accounts').select('primary_owner_user_id').eq('id', account_id).execute()
        if account_result.data and len(account_result.data) > 0:
            account = account_result.data[0]
            if account.get('primary_owner_user_id') == user_id:
                return project_data
    
    raise HTTPException(status_code=403, detail="Not authorized to access this sandbox")

async def get_sandbox_by_id_safely(client, sandbox_id: str) -> AsyncSandbox:
    """
    Safely retrieve a sandbox object by its ID, using the project that owns it.
    
    Args:
        client: The Supabase client
        sandbox_id: The sandbox ID to retrieve
    
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
    
    # project_id = project_result.data[0]['project_id']
    # logger.debug(f"Found project {project_id} for sandbox {sandbox_id}")
    
    try:
        # Get the sandbox
        sandbox = await get_or_start_sandbox(sandbox_id)
        # Extract just the sandbox object from the tuple (sandbox, sandbox_id, sandbox_pass)
        # sandbox = sandbox_tuple[0]
            
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
        # Get sandbox using the safer method
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id)
        
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
            
        account_id = project_data.get('account_id')
        
        # Verify account ownership (simplified for personal accounts only)
        if account_id:
            # Check if the user is the primary owner of this account
            account_result = await client.schema('basejump').from_('accounts').select('primary_owner_user_id').eq('id', account_id).execute()
            if not (account_result.data and len(account_result.data) > 0 and account_result.data[0].get('primary_owner_user_id') == user_id):
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
        
        # Get sandbox using the safer method
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id)
        
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
            from daytona_sdk import SessionExecuteRequest
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
        # Get sandbox using the safer method
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id)
        
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
        
        # Get sandbox using the safer method
        sandbox = await get_sandbox_by_id_safely(client, sandbox_id)
        
        # Get the Daytona preview link for the appropriate port
        try:
            preview_info = await sandbox.get_preview_link(port)
            url = preview_info.url if hasattr(preview_info, 'url') else str(preview_info)
            
            return {
                "preview_url": url,
                "status": "available"
            }
            
        except Exception as preview_error:
            logger.error(f"Could not get preview link for sandbox {sandbox_id} on port {port}: {str(preview_error)}")
            
            # Try to check if dev server is running on the correct port
            try:
                health_check = await sandbox.process.exec(f"curl -s http://localhost:{port} -o /dev/null -w '%{{http_code}}' || echo '000'", timeout=10)
                if health_check.result.strip() == '000':
                    return {
                        "preview_url": None,
                        "status": "dev_server_not_running"
                    }
                else:
                    return {
                        "preview_url": None,
                        "status": "preview_not_available"
                    }
            except:
                return {
                    "preview_url": None,
                    "status": "error"
                }
                
    except Exception as e:
        logger.error(f"Error getting preview URL for sandbox {sandbox_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting preview URL: {str(e)}")


# Complex proxy endpoint removed - replaced with simple preview URL endpoint above
