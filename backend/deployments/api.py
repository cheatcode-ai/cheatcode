from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any, Tuple
import re

from utils.auth_utils import get_current_user_id_from_jwt, get_account_id_or_raise
from services.supabase import DBConnection
from utils.logger import logger
from utils.config import config
from utils.constants import get_plan_deployment_limit

from sandbox.sandbox import get_or_start_sandbox
from services.billing import get_user_subscription
from services import redis as redis_service
from services.vercel_deploy import VercelDeploymentService, collect_files_for_vercel

# Redis key prefix for deployment progress tracking
DEPLOYMENT_PROGRESS_KEY_PREFIX = "deployment_progress:"
DEPLOYMENT_PROGRESS_TTL = 600  # 10 minutes TTL for progress keys


async def set_deployment_progress(project_id: str, state: str, message: str = None):
    """Set deployment progress in Redis for real-time status updates.

    States: 'preparing', 'pushing', 'building', 'deploying', 'deployed', 'failed'
    """
    try:
        import json
        key = f"{DEPLOYMENT_PROGRESS_KEY_PREFIX}{project_id}"
        data = {
            "state": state,
            "message": message or f"Deployment {state}",
            "timestamp": __import__('time').time()
        }
        await redis_service.set_value(key, json.dumps(data), ttl=DEPLOYMENT_PROGRESS_TTL)
        logger.debug(f"Set deployment progress for {project_id}: {state}")
    except Exception as e:
        logger.warning(f"Failed to set deployment progress (non-critical): {e}")


async def get_deployment_progress(project_id: str) -> Optional[Dict[str, Any]]:
    """Get deployment progress from Redis.

    Returns None if no progress is tracked, otherwise returns the progress state.
    """
    try:
        import json
        key = f"{DEPLOYMENT_PROGRESS_KEY_PREFIX}{project_id}"
        data = await redis_service.get_value(key)
        if data:
            return json.loads(data)
        return None
    except Exception as e:
        logger.warning(f"Failed to get deployment progress (non-critical): {e}")
        return None


async def clear_deployment_progress(project_id: str):
    """Clear deployment progress from Redis after deployment completes."""
    try:
        key = f"{DEPLOYMENT_PROGRESS_KEY_PREFIX}{project_id}"
        await redis_service.delete_key(key)
        logger.debug(f"Cleared deployment progress for {project_id}")
    except Exception as e:
        logger.warning(f"Failed to clear deployment progress (non-critical): {e}")


router = APIRouter(tags=["deployments"])
db = DBConnection()


async def _count_deployed_projects_for_account(client, account_id: str) -> int:
    """Count projects with active Vercel deployments."""
    try:
        # Use a more efficient query with database-side filtering
        res = await client.rpc('count_deployed_projects_for_account', {'p_account_id': account_id}).execute()
        return res.data or 0
    except Exception:
        # Fallback: count projects with Vercel deployments
        res = await client.table('projects').select('sandbox').eq('user_id', account_id).execute()
        count = 0
        for p in res.data or []:
            sandbox_info = p.get('sandbox') or {}
            if isinstance(sandbox_info, dict):
                vercel_meta = sandbox_info.get('vercel') or {}
                if isinstance(vercel_meta, dict) and vercel_meta.get('last_deployment_id'):
                    count += 1
        return count


# FastAPI Dependency Functions for shared logic

async def get_validated_project(
    project_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
) -> Dict[str, Any]:
    """FastAPI dependency to fetch and validate project ownership."""
    client = await db.client
    account_id = await get_account_id_or_raise(client, user_id)
    
    result = await client.table('projects').select(
        'project_id, name, user_id, sandbox, app_type'
    ).eq('project_id', project_id).eq('user_id', account_id).single().execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found or access denied")
    
    return result.data

async def get_validated_project_with_quota_check(
    project_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
) -> Tuple[Dict[str, Any], str, str]:
    """FastAPI dependency to fetch project and perform quota checks."""
    project = await get_validated_project(project_id, user_id)
    client = await db.client
    account_id = project['user_id']
    
    # Check quota if this is the first deployment for this project
    if not await _project_already_deployed(project):
        subscription = await get_user_subscription(user_id)
        plan_id = (subscription or {}).get('plan') or 'free'
        max_deployed = get_plan_deployment_limit(plan_id)
        
        current_deployed = await _count_deployed_projects_for_account(client, account_id)
        if current_deployed >= max_deployed:
            raise HTTPException(
                status_code=403, 
                detail=f"Deployment limit reached. Your {plan_id} plan allows {max_deployed} deployed projects."
            )
    
    return project, account_id, user_id

async def _project_already_deployed(project: Dict[str, Any]) -> bool:
    """Check if project has an active Vercel deployment."""
    sandbox_info = project.get('sandbox') or {}
    if isinstance(sandbox_info, dict):
        vercel_meta = sandbox_info.get('vercel') or {}
        if isinstance(vercel_meta, dict) and vercel_meta.get('last_deployment_id'):
            return True
    return False


def _sanitize_vercel_name(project_name: str, project_id: str) -> str:
    """Sanitize project name for Vercel (lowercase, alphanumeric, hyphens only)."""
    vercel_name = re.sub(r'[^a-z0-9-]', '-', project_name.lower())
    vercel_name = re.sub(r'-+', '-', vercel_name).strip('-')[:100]
    return vercel_name or f"project-{project_id[:8]}"


async def _execute_vercel_deployment(
    project: Dict[str, Any],
    account_id: str,
    is_redeploy: bool = False
) -> Dict[str, Any]:
    """
    Core deployment logic shared by deploy and redeploy endpoints.

    Handles: file collection, Vercel API calls, database updates, progress tracking.
    """
    project_id = project['project_id']
    project_name = project.get('name', f"project-{project_id[:8]}")
    client = await db.client

    sandbox_info = project.get('sandbox') or {}
    sandbox_id = sandbox_info.get('id') if isinstance(sandbox_info, dict) else None
    if not sandbox_id:
        raise HTTPException(status_code=404, detail="Project sandbox not found")

    # Get existing Vercel project name or create one
    vercel_info = sandbox_info.get('vercel') or {}
    vercel_name = vercel_info.get('project_name') if is_redeploy else None
    if not vercel_name:
        vercel_name = _sanitize_vercel_name(project_name, project_id)

    action = "redeployment" if is_redeploy else "deployment"

    try:
        # Phase 1: Prepare
        await set_deployment_progress(project_id, "preparing", f"Starting {action}...")

        vercel = VercelDeploymentService()
        vercel_project = await vercel.ensure_project(vercel_name)
        logger.info(f"Vercel project ready: {vercel_name} (id: {vercel_project.get('id')})")

        # Phase 2: Collect files
        await set_deployment_progress(project_id, "pushing", "Collecting files...")

        sandbox = await get_or_start_sandbox(sandbox_id)
        app_type = project.get('app_type', 'web')
        workdir = '/workspace/cheatcode-mobile' if app_type == 'mobile' else '/workspace/cheatcode-app'

        files = await collect_files_for_vercel(sandbox, workdir)
        logger.info(f"Collected {len(files)} files for Vercel {action}")

        if not files:
            raise HTTPException(status_code=400, detail="No files found in workspace to deploy")

        # Phase 3: Deploy to Vercel (returns immediately, build happens async)
        await set_deployment_progress(project_id, "building", f"Deploying to Vercel...")

        deployment = await vercel.deploy_files(
            project_name=vercel_name,
            files=files,
            target="production"
        )

        deployment_id = deployment.get('id')
        deployment_url = deployment.get('url')

        if not deployment_id:
            raise Exception("Vercel API did not return a deployment ID")

        logger.info(f"Vercel {action} created: {deployment_id} -> {deployment_url}")

        # Save deployment info to database
        updated_sandbox = dict(sandbox_info)
        updated_sandbox['vercel'] = {
            'project_id': vercel_project.get('id'),
            'project_name': vercel_name,
            'last_deployment_id': deployment_id,
            'url': deployment_url,
            'domains': [deployment_url],
        }

        await client.table('projects').update({
            'sandbox': updated_sandbox
        }).eq('project_id', project_id).eq('user_id', account_id).execute()

        return {
            'deploymentId': deployment_id,
            'domains': [deployment_url],
            'url': f"https://{deployment_url}",
            'status': 'ok'
        }

    except HTTPException:
        await clear_deployment_progress(project_id)
        raise
    except Exception as e:
        logger.error(f"Vercel {action} failed: {e}")
        await set_deployment_progress(project_id, "failed", str(e)[:100])
        raise HTTPException(status_code=500, detail=f"{action.capitalize()} failed: {str(e)}")


@router.post("/project/{project_id}/deploy/git")
async def deploy_to_vercel(
    project_data: Tuple[Dict[str, Any], str, str] = Depends(get_validated_project_with_quota_check),
):
    """Deploy project to Vercel using inline file upload (fast, non-blocking).

    - Files are collected from sandbox and sent directly to Vercel
    - Vercel API returns immediately, build happens async on Vercel's infrastructure
    - User wait time: 5-30 seconds
    """
    if not config.VERCEL_BEARER_TOKEN:
        raise HTTPException(status_code=500, detail="Vercel API not configured")

    project, account_id, _ = project_data
    return await _execute_vercel_deployment(project, account_id, is_redeploy=False)


@router.post("/project/{project_id}/deploy/git/update")
async def update_deployment(
    project: Dict[str, Any] = Depends(get_validated_project),
):
    """Redeploy project to Vercel with latest changes.

    For Vercel, this is the same as a fresh deployment - we collect all files
    and send them to Vercel. Vercel handles versioning automatically.
    """
    if not config.VERCEL_BEARER_TOKEN:
        raise HTTPException(status_code=500, detail="Vercel API not configured")

    return await _execute_vercel_deployment(project, project['user_id'], is_redeploy=True)


@router.get("/project/{project_id}/deployment/status")
async def get_deployment_status(
    project: Dict[str, Any] = Depends(get_validated_project),
):
    """Get the deployment status for a project (Vercel).
    Returns: { has_deployment: bool, domains: string[], url: string?, last_deployment_id: string? }
    """
    sandbox_info = project.get('sandbox') or {}
    vercel = (sandbox_info.get('vercel') or {}) if isinstance(sandbox_info, dict) else {}

    # Check if project has Vercel deployment
    has_deployment = bool(vercel.get('last_deployment_id'))

    return {
        "has_deployment": has_deployment,
        "domains": vercel.get('domains', []),
        "url": vercel.get('url'),
        "last_deployment_id": vercel.get('last_deployment_id'),
        "project_name": vercel.get('project_name'),
        # Include app_type so the frontend can hide deploy UI for mobile projects
        "app_type": project.get('app_type', 'web'),
    }


@router.get("/project/{project_id}/deployment/live-status")
async def get_deployment_live_status(
    project: Dict[str, Any] = Depends(get_validated_project),
):
    """Get the real-time deployment status from Vercel API.

    Returns actual build/deployment state from Vercel.
    States: 'preparing', 'pushing', 'building', 'deploying', 'deployed', 'failed', 'unknown'

    Vercel readyState values:
    - QUEUED: Waiting to build
    - BUILDING: Build in progress
    - READY: Successfully deployed
    - ERROR: Build/deploy failed
    - CANCELED: Deployment was canceled
    """
    project_id = project['project_id']
    sandbox_info = project.get('sandbox') or {}
    vercel = (sandbox_info.get('vercel') or {}) if isinstance(sandbox_info, dict) else {}
    deployment_id = vercel.get('last_deployment_id')

    # First, check if there's an in-progress deployment tracked in Redis
    progress = await get_deployment_progress(project_id)
    if progress:
        state = progress.get('state', 'preparing')
        message = progress.get('message', f'Deployment {state}')
        return {
            "state": state,
            "message": message,
            "deployment_id": deployment_id,
            "in_progress": True,
        }

    if not deployment_id:
        return {
            "state": "none",
            "message": "No deployment found",
            "deployment_id": None,
        }

    if not config.VERCEL_BEARER_TOKEN:
        return {
            "state": "unknown",
            "message": "Vercel API not configured",
            "deployment_id": deployment_id,
        }

    # Fetch real status from Vercel API
    try:
        vercel_service = VercelDeploymentService()
        data = await vercel_service.get_deployment_status(deployment_id)

        ready_state = data.get('readyState', 'UNKNOWN')
        url = data.get('url')
        created_at = data.get('createdAt')
        ready_at = data.get('ready')

        # Map Vercel readyState to user-friendly states
        state_map = {
            'QUEUED': 'building',
            'BUILDING': 'building',
            'INITIALIZING': 'building',
            'READY': 'deployed',
            'ERROR': 'failed',
            'CANCELED': 'failed',
        }
        friendly_state = state_map.get(ready_state, 'unknown')

        # Clear deployment progress from Redis when deployment is complete
        if friendly_state in ('deployed', 'failed'):
            await clear_deployment_progress(project_id)

        return {
            "state": friendly_state,
            "raw_state": ready_state,
            "deployment_id": deployment_id,
            "url": url,
            "created_at": created_at,
            "ready_at": ready_at,
            "domains": [url] if url else [],
        }

    except Exception as e:
        logger.error(f"Failed to fetch Vercel deployment status: {e}")
        return {
            "state": "unknown",
            "message": str(e),
            "deployment_id": deployment_id,
        }
