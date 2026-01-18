from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from services.supabase import DBConnection
from utils.auth_utils import (
    get_current_user_id_from_jwt,
    get_optional_user_id,
    get_account_id_for_clerk_user,
    get_account_id_or_raise,
)
from utils.logger import logger

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
    current_user_id: str = Depends(get_current_user_id_from_jwt),
    limit: int = 100,
    offset: int = 0
):
    """Get projects for the authenticated user with pagination"""
    try:
        client = await db.client

        # Get the account ID for this Clerk user using centralized helper
        account_id = await get_account_id_for_clerk_user(client, current_user_id)
        if not account_id:
            logger.warning(f"No account mapping found for Clerk user {current_user_id}")
            return []

        # Query projects for this account with pagination and ordering
        # Only select columns needed for the API response to reduce data transfer
        result = await client.table('projects')\
            .select('project_id, name, description, user_id, created_at, updated_at, sandbox, is_public, app_type')\
            .eq('user_id', account_id)\
            .order('created_at', desc=True)\
            .range(offset, offset + limit - 1)\
            .execute()

        projects = []
        for project_data in result.data or []:
            projects.append(Project(
                id=project_data['project_id'],
                name=project_data.get('name', '') or '',
                description=project_data.get('description', '') or '',
                account_id=project_data.get('user_id', '') or '',  # Map user_id to account_id for API
                created_at=str(project_data['created_at']),
                updated_at=str(project_data.get('updated_at')) if project_data.get('updated_at') else None,
                sandbox=project_data.get('sandbox') or {},
                is_public=bool(project_data.get('is_public')),
                app_type=project_data.get('app_type', 'web')
            ))
        
        logger.info(f"Retrieved {len(projects)} projects for user {current_user_id}")
        return projects
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching projects for user {current_user_id}: {str(e)}")
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

        # Fetch the project row - only select needed columns
        result = await client.table('projects').select(
            'project_id, name, description, user_id, created_at, updated_at, sandbox, is_public, app_type'
        ).eq('project_id', project_id).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Project not found")

        project_data = result.data[0]

        # If the project is not public, verify access when a user is provided
        if not project_data.get('is_public', False):
            if current_user_id is None:
                raise HTTPException(status_code=403, detail="Authentication required to access this project")

            # Verify the authenticated user belongs to the same account as the project
            user_account_id = await get_account_id_or_raise(client, current_user_id, error_code=403)
            if user_account_id != project_data.get('user_id'):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")

        project = Project(
            id=project_data['project_id'],
            name=project_data.get('name', '') or '',
            description=project_data.get('description', '') or '',
            account_id=project_data.get('user_id', '') or '',  # Map user_id to account_id for API
            created_at=str(project_data['created_at']),
            updated_at=str(project_data.get('updated_at')) if project_data.get('updated_at') else None,
            sandbox=project_data.get('sandbox') or {},
            is_public=bool(project_data.get('is_public')),
            app_type=project_data.get('app_type', 'web')
        )

        logger.info(f"Retrieved project {project_id} for user {current_user_id}")
        return project

    except HTTPException:
        # Re-raise expected HTTP errors
        raise
    except Exception as e:
        logger.error(f"Error fetching project {project_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch project")

@router.get("/threads", response_model=List[Thread])
async def get_threads(
    project_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Get all threads for the authenticated user, optionally filtered by project.

    Supports pagination with limit and offset parameters.
    """
    try:
        client = await db.client

        # Get the account ID for this Clerk user using centralized helper
        account_id = await get_account_id_for_clerk_user(client, current_user_id)
        if not account_id:
            logger.warning(f"No account mapping found for Clerk user {current_user_id}")
            return []

        # Build query with server-side filtering for agent builder threads
        # and pagination for performance - only select needed columns
        query = client.table('threads').select(
            'thread_id, user_id, project_id, is_public, created_at, updated_at, metadata'
        ).eq('user_id', account_id)

        if project_id:
            query = query.eq('project_id', project_id)

        # Add ordering and pagination
        query = query.order('updated_at', desc=True).range(offset, offset + limit - 1)

        result = await query.execute()

        threads = []
        for thread_data in result.data or []:
            metadata = thread_data.get('metadata', {})

            threads.append(Thread(
                thread_id=thread_data['thread_id'],
                account_id=thread_data.get('user_id'),  # Map user_id to account_id for API
                project_id=thread_data.get('project_id'),
                is_public=thread_data.get('is_public', False),
                created_at=thread_data['created_at'],
                updated_at=thread_data['updated_at'],
                metadata=metadata
            ))

        logger.info(f"Retrieved {len(threads)} threads for user {current_user_id}")
        return threads

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching threads for user {current_user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch threads")

@router.post("/projects", response_model=Project)
async def create_project(
    project_data: CreateProjectRequest,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Create a new project for the authenticated user"""
    try:
        client = await db.client

        # Get the account ID for this Clerk user using centralized helper
        account_id = await get_account_id_or_raise(client, current_user_id)

        # Create the project
        result = await client.table('projects').insert({
            'name': project_data.name,
            'description': project_data.description,
            'user_id': account_id
        }).select().execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Project creation returned no data")

        project_data = result.data[0]

        project = Project(
            id=project_data['project_id'],
            name=project_data['name'],
            description=project_data['description'] or '',
            account_id=project_data['user_id'],  # Map user_id to account_id for API
            created_at=project_data['created_at'],
            updated_at=project_data.get('updated_at'),
            sandbox=project_data.get('sandbox', {}),
            is_public=project_data.get('is_public', False)
        )
        
        logger.info(f"Created project {project.id} for user {current_user_id}")
        return project
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating project for user {current_user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to create project")

@router.post("/threads", response_model=Thread)
async def create_thread(
    thread_data: CreateThreadRequest,
    current_user_id: str = Depends(get_current_user_id_from_jwt)
):
    """Create a new thread for the authenticated user"""
    try:
        client = await db.client

        # Get the account ID for this Clerk user using centralized helper
        account_id = await get_account_id_or_raise(client, current_user_id)

        # Create the thread
        result = await client.table('threads').insert({
            'project_id': thread_data.project_id,
            'user_id': account_id
        }).select().execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Thread creation returned no data")

        thread_data = result.data[0]

        thread = Thread(
            thread_id=thread_data['thread_id'],
            account_id=thread_data.get('user_id'),  # Map user_id to account_id for API
            project_id=thread_data.get('project_id'),
            is_public=thread_data.get('is_public', False),
            created_at=thread_data['created_at'],
            updated_at=thread_data['updated_at'],
            metadata=thread_data.get('metadata', {})
        )
        
        logger.info(f"Created thread {thread.thread_id} for user {current_user_id}")
        return thread
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating thread for user {current_user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to create thread") 