from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from services.supabase import DBConnection
from utils.auth_utils import get_current_user_id_from_jwt, get_optional_user_id
from utils.logger import structlog

router = APIRouter(tags=["projects", "threads"])

class Project(BaseModel):
    id: str
    name: str
    description: str
    account_id: str
    created_at: str
    updated_at: Optional[str] = None
    sandbox: Dict[str, Any] = {}
    is_public: bool = False
    app_type: Optional[str] = 'web'  # Type of application (web or mobile)

class Thread(BaseModel):
    thread_id: str
    account_id: Optional[str] = None
    project_id: Optional[str] = None
    is_public: bool = False
    created_at: str
    updated_at: str
    metadata: Optional[Dict[str, Any]] = None

class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""

class CreateThreadRequest(BaseModel):
    project_id: str

db = DBConnection()

@router.get("/projects", response_model=List[Project])
async def get_projects(
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get all projects for the authenticated user"""
    try:
        client = await db.client
        
        # Get the account ID for this Clerk user
        account_result = await client.rpc('get_account_id_for_clerk_user', {'clerk_user_id': current_user_id}).execute()
        if not account_result.data:
            structlog.get_logger().warning(f"No account mapping found for Clerk user {current_user_id}")
            return []
        
        account_id = account_result.data
        
        # Query projects for this account
        result = await client.table('projects').select('*').eq('account_id', account_id).execute()
        
        projects = []
        for project_data in result.data or []:
            projects.append(Project(
                id=project_data['project_id'],
                name=project_data.get('name', '') or '',
                description=project_data.get('description', '') or '',
                account_id=project_data.get('account_id', '') or '',
                created_at=str(project_data['created_at']),
                updated_at=str(project_data.get('updated_at')) if project_data.get('updated_at') else None,
                sandbox=project_data.get('sandbox') or {},
                is_public=bool(project_data.get('is_public')),
                app_type=project_data.get('app_type', 'web')
            ))
        
        structlog.get_logger().info(f"Retrieved {len(projects)} projects for user {current_user_id}")
        return projects
        
    except HTTPException:
        raise
    except Exception as e:
        structlog.get_logger().error(f"Error fetching projects for user {current_user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch projects")

# ---------------------------------------------------------------------------
# Project detail endpoint
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}", response_model=Project)
async def get_project(
    project_id: str,
    current_user_id: Optional[str] = Depends(get_optional_user_id)
):
    """Get a single project by ID.

    This endpoint supports both authenticated and unauthenticated (public) access. If the
    project is marked as public (is_public = True), anyone can fetch it. Otherwise the caller
    must be authenticated and belong to the same account that owns the project.
    """
    try:
        client = await db.client

        # Fetch the project row
        result = await client.table('projects').select('*').eq('project_id', project_id).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Project not found")

        project_data = result.data[0]

        # If the project is not public, verify access when a user is provided
        if not project_data.get('is_public', False):
            if current_user_id is None:
                raise HTTPException(status_code=403, detail="Authentication required to access this project")

            # Verify the authenticated user belongs to the same account as the project
            account_result = await client.rpc('get_account_id_for_clerk_user', {'clerk_user_id': current_user_id}).execute()
            if not account_result.data:
                raise HTTPException(status_code=403, detail="User account not found")

            user_account_id = account_result.data
            if user_account_id != project_data.get('account_id'):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")

        project = Project(
            id=project_data['project_id'],
            name=project_data.get('name', '') or '',
            description=project_data.get('description', '') or '',
            account_id=project_data.get('account_id', '') or '',
            created_at=str(project_data['created_at']),
            updated_at=str(project_data.get('updated_at')) if project_data.get('updated_at') else None,
            sandbox=project_data.get('sandbox') or {},
            is_public=bool(project_data.get('is_public')),
            app_type=project_data.get('app_type', 'web')
        )

        structlog.get_logger().info(f"Retrieved project {project_id} for user {current_user_id}")
        return project

    except HTTPException:
        # Re-raise expected HTTP errors
        raise
    except Exception as e:
        structlog.get_logger().error(f"Error fetching project {project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch project")

@router.get("/threads", response_model=List[Thread])
async def get_threads(
    project_id: Optional[str] = None,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get all threads for the authenticated user, optionally filtered by project"""
    try:
        client = await db.client
        
        # Get the account ID for this Clerk user
        account_result = await client.rpc('get_account_id_for_clerk_user', {'clerk_user_id': current_user_id}).execute()
        if not account_result.data:
            structlog.get_logger().warning(f"No account mapping found for Clerk user {current_user_id}")
            return []
        
        account_id = account_result.data
        
        # Build query
        query = client.table('threads').select('*').eq('account_id', account_id)
        
        if project_id:
            query = query.eq('project_id', project_id)
        
        result = await query.execute()
        
        threads = []
        for thread_data in result.data or []:
            # Filter out agent builder threads
            metadata = thread_data.get('metadata', {})
            if metadata.get('is_agent_builder'):
                continue
                
            threads.append(Thread(
                thread_id=thread_data['thread_id'],
                account_id=thread_data.get('account_id'),
                project_id=thread_data.get('project_id'),
                is_public=thread_data.get('is_public', False),
                created_at=thread_data['created_at'],
                updated_at=thread_data['updated_at'],
                metadata=metadata
            ))
        
        structlog.get_logger().info(f"Retrieved {len(threads)} threads for user {current_user_id}")
        return threads
        
    except HTTPException:
        raise
    except Exception as e:
        structlog.get_logger().error(f"Error fetching threads for user {current_user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch threads")

@router.post("/projects", response_model=Project)
async def create_project(
    project_data: CreateProjectRequest,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Create a new project for the authenticated user"""
    try:
        client = await db.client
        
        # Get the account ID for this Clerk user
        account_result = await client.rpc('get_account_id_for_clerk_user', {'clerk_user_id': current_user_id}).execute()
        if not account_result.data:
            raise HTTPException(status_code=400, detail="User account not found")
        
        account_id = account_result.data
        
        # Create the project
        result = await client.table('projects').insert({
            'name': project_data.name,
            'description': project_data.description,
            'account_id': account_id
        }).select().execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Project creation returned no data")
        
        project_data = result.data[0]
        
        project = Project(
            id=project_data['project_id'],
            name=project_data['name'],
            description=project_data['description'] or '',
            account_id=project_data['account_id'],
            created_at=project_data['created_at'],
            updated_at=project_data.get('updated_at'),
            sandbox=project_data.get('sandbox', {}),
            is_public=project_data.get('is_public', False)
        )
        
        structlog.get_logger().info(f"Created project {project.id} for user {current_user_id}")
        return project
        
    except HTTPException:
        raise
    except Exception as e:
        structlog.get_logger().error(f"Error creating project for user {current_user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to create project")

@router.post("/threads", response_model=Thread)
async def create_thread(
    thread_data: CreateThreadRequest,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Create a new thread for the authenticated user"""
    try:
        client = await db.client
        
        # Get the account ID for this Clerk user
        account_result = await client.rpc('get_account_id_for_clerk_user', {'clerk_user_id': current_user_id}).execute()
        if not account_result.data:
            raise HTTPException(status_code=400, detail="User account not found")
        
        account_id = account_result.data
        
        # Create the thread
        result = await client.table('threads').insert({
            'project_id': thread_data.project_id,
            'account_id': account_id
        }).select().execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Thread creation returned no data")
        
        thread_data = result.data[0]
        
        thread = Thread(
            thread_id=thread_data['thread_id'],
            account_id=thread_data.get('account_id'),
            project_id=thread_data.get('project_id'),
            is_public=thread_data.get('is_public', False),
            created_at=thread_data['created_at'],
            updated_at=thread_data['updated_at'],
            metadata=thread_data.get('metadata', {})
        )
        
        structlog.get_logger().info(f"Created thread {thread.thread_id} for user {current_user_id}")
        return thread
        
    except HTTPException:
        raise
    except Exception as e:
        structlog.get_logger().error(f"Error creating thread for user {current_user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to create thread") 