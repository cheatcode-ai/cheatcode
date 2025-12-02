from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Optional, List, Dict, Any, Tuple

from utils.auth_utils import get_current_user_id_from_jwt
from services.supabase import DBConnection
from utils.logger import logger
from utils.config import config

from sandbox.sandbox import get_or_start_sandbox
from daytona import AsyncSandbox
import httpx
from services.billing import get_user_subscription


async def _git_has_commits(sandbox: AsyncSandbox, workdir: str) -> bool:
    """Check if git repository has any commits using native SDK status."""
    try:
        status = await sandbox.git.status(workdir)
        # If we can get status with a current_branch, repo has commits
        return status.current_branch is not None
    except Exception:
        # Status fails if no commits exist
        return False


async def _git_has_changes(sandbox: AsyncSandbox, workdir: str) -> bool:
    """Check if there are uncommitted changes using native SDK status."""
    try:
        status = await sandbox.git.status(workdir)
        # Check if there are any file changes
        return bool(status.file_status and len(status.file_status) > 0)
    except Exception as e:
        logger.warning(f"Failed to check git status: {e}")
        return False


async def _git_stage_and_commit(
    sandbox: AsyncSandbox,
    workdir: str,
    message: str,
    author: str = "cheatcode",
    email: str = "deploy@cheatcode"
) -> bool:
    """Stage all files and commit using native SDK methods."""
    try:
        # Stage all files
        await sandbox.git.add(workdir, ["."])

        # Commit changes
        commit_response = await sandbox.git.commit(
            path=workdir,
            message=message,
            author=author,
            email=email
        )
        logger.info(f"Created commit: {commit_response.sha if hasattr(commit_response, 'sha') else 'success'}")
        return True
    except Exception as e:
        logger.error(f"Failed to stage and commit: {e}")
        return False


async def _git_push_with_auth(
    sandbox: AsyncSandbox,
    workdir: str,
    username: str,
    password: str
) -> bool:
    """Push changes to remote using native SDK method."""
    try:
        await sandbox.git.push(
            path=workdir,
            username=username,
            password=password
        )
        logger.info("Push completed successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to push: {e}")
        return False

router = APIRouter(tags=["deployments"])
db = DBConnection()
async def _get_account_id(client, user_id: str) -> str:
    res = await client.rpc('get_account_id_for_clerk_user', {'p_clerk_user_id': user_id}).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User account not found")
    return res.data


def _max_deployed_for_plan(plan_id: str) -> int:
    plan_id = (plan_id or 'free').lower()
    if plan_id == 'free':
        return 1
    if plan_id == 'pro':
        return 10
    if plan_id == 'premium':
        return 25
    if plan_id == 'byok':
        return 100
    return 1


async def _count_deployed_projects_for_account(client, account_id: str) -> int:
    # Use database aggregation instead of fetching all data and counting in Python
    try:
        # Use a more efficient query with database-side filtering
        res = await client.rpc('count_deployed_projects_for_account', {'p_account_id': account_id}).execute()
        return res.data or 0
    except Exception:
        # Fallback to original method with optimized SELECT (only fetch sandbox column)
        res = await client.table('projects').select('sandbox').eq('user_id', account_id).execute()
        count = 0
        for p in res.data or []:
            sandbox_info = p.get('sandbox') or {}
            if isinstance(sandbox_info, dict):
                fs_meta = sandbox_info.get('freestyle') or {}
                if isinstance(fs_meta, dict) and fs_meta.get('last_deployment_id'):
                    count += 1
        return count


# FastAPI Dependency Functions for shared logic

async def get_validated_project(
    project_id: str,
    user_id: str = Depends(get_current_user_id_from_jwt)
) -> Dict[str, Any]:
    """FastAPI dependency to fetch and validate project ownership."""
    client = await db.client
    account_id = await _get_account_id(client, user_id)
    
    result = await client.table('projects').select(
        'project_id, name, user_id, sandbox, has_freestyle_deployment'
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
        max_deployed = _max_deployed_for_plan(plan_id)
        
        current_deployed = await _count_deployed_projects_for_account(client, account_id)
        if current_deployed >= max_deployed:
            raise HTTPException(
                status_code=403, 
                detail=f"Deployment limit reached. Your {plan_id} plan allows {max_deployed} deployed projects."
            )
    
    return project, account_id, user_id

async def _project_already_deployed(project: Dict[str, Any]) -> bool:
    # Use the computed column for faster checks
    return project.get('has_freestyle_deployment', False)


async def _ensure_git_identity_and_token(repo_id: str, name_hint: str) -> Tuple[str, str]:
    """Create (or reuse) a Freestyle Git identity, grant repo write, and create a token.
    Returns (identity_id, token). Never persist the token.
    """
    headers = {"Authorization": f"Bearer {config.FREESTYLE_API_KEY}", "Content-Type": "application/json"}
    base = "https://api.freestyle.sh"
    async with httpx.AsyncClient(timeout=20.0) as client:
        # Try to create identity
        identity_id: Optional[str] = None
        try:
            resp = await client.post(f"{base}/git/v1/identity", headers=headers, json={"name": name_hint})
            if resp.status_code in (200, 201):
                data = resp.json()
                identity_id = data.get('id') or data.get('identityId') or data.get('identity_id')
        except Exception as e:
            logger.warning(f"Create identity failed (continuing to list): {e}")

        if not identity_id:
            # List identities and pick deterministically (by name match or alphabetically first)
            try:
                resp = await client.get(f"{base}/git/v1/identity", headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    # Response structure: {"identities": [...], "offset": 0, "total": N}
                    identities = data.get('identities', [])
                    if isinstance(identities, list) and identities:
                        # Try to find an identity with matching name first
                        for identity in identities:
                            if identity.get('name') == name_hint:
                                identity_id = identity.get('id')
                                logger.info(f"Found existing identity with matching name: {name_hint}")
                                break
                        
                        # If no name match, pick the alphabetically first one for deterministic behavior
                        if not identity_id:
                            sorted_identities = sorted(identities, key=lambda x: x.get('name', ''))
                            if sorted_identities:
                                identity_id = sorted_identities[0].get('id')
                                logger.info(f"Using alphabetically first identity: {sorted_identities[0].get('name')}")
            except Exception as e:
                logger.error(f"List identities failed: {e}")
                raise HTTPException(status_code=500, detail="Failed to manage Freestyle Git identity")

        if not identity_id:
            raise HTTPException(status_code=500, detail="Freestyle Git identity not available")

        # Grant write permission to repo
        try:
            await client.post(
                f"{base}/git/v1/identity/{identity_id}/permissions/{repo_id}",
                headers=headers,
                json={"permission": "write"}
            )
        except Exception as e:
            logger.warning(f"Grant permission failed (might already have): {e}")

        # Create token
        try:
            resp = await client.post(f"{base}/git/v1/identity/{identity_id}/tokens", headers=headers)
            if resp.status_code in (200, 201):
                data = resp.json()
                token = data.get('token') or data.get('value')
                if not token:
                    raise Exception("No token in response")
                return identity_id, token
            else:
                logger.error(f"Create token failed: {resp.status_code} {resp.text}")
        except Exception as e:
            logger.error(f"Create token exception: {e}")
            raise HTTPException(status_code=500, detail="Failed to create Freestyle Git access token")



@router.post("/project/{project_id}/freestyle/repo/ensure")
async def ensure_freestyle_repo(
    project: Dict[str, Any] = Depends(get_validated_project),
):
    """Ensure a Freestyle Git repository exists for the project.
    Stores repo metadata under projects.sandbox.freestyle.
    """
    if not config.FREESTYLE_API_KEY:
        raise HTTPException(status_code=500, detail="Freestyle API key not configured")

    project_id = project['project_id']
    account_id = project['user_id']
    client = await db.client
    sandbox_info = project.get('sandbox') or {}
    freestyle = (sandbox_info.get('freestyle') or {}) if isinstance(sandbox_info, dict) else {}

    if freestyle.get('repo_id') and freestyle.get('repo_url'):
        return {"repo_id": freestyle['repo_id'], "repo_url": freestyle['repo_url']}

    # Create repo via Freestyle SDK with rollback mechanism
    created_repo_id = None
    try:
        import freestyle as fs
        client_fs = fs.Freestyle(config.FREESTYLE_API_KEY)

        repo = client_fs.create_repository(
            name=project.get('name') or f"project-{project_id}",
            public=False,
        )
        repo_id = getattr(repo, 'repoId', None) or getattr(repo, 'repo_id', None) or getattr(repo, 'id', None)
        repo_url = f"https://git.freestyle.sh/{repo_id}" if repo_id else None

        if not repo_id or not repo_url:
            logger.error(f"Freestyle repo creation returned unexpected response: {repo}")
            raise HTTPException(status_code=502, detail="Failed to create Freestyle repository")

        created_repo_id = repo_id  # Track for potential rollback

        # Persist under projects.sandbox.freestyle - this could fail
        updated_sandbox = sandbox_info if isinstance(sandbox_info, dict) else {}
        updated_sandbox['freestyle'] = {
            'repo_id': repo_id,
            'repo_url': repo_url,
            'branch': 'main',
            'auto_deploy_on_push': True,
        }

        result = await client.table('projects').update({ 'sandbox': updated_sandbox }).eq('project_id', project_id).eq('user_id', account_id).execute()
        
        if not result.data:
            raise Exception("Failed to update project with repository metadata")

        return {"repo_id": repo_id, "repo_url": repo_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error ensuring Freestyle repo: {e}")
        
        # Rollback: If we created a repo but failed to save metadata, try to delete the repo
        if created_repo_id:
            try:
                logger.info(f"Attempting to rollback: delete repository {created_repo_id}")
                import httpx
                headers = {"Authorization": f"Bearer {config.FREESTYLE_API_KEY}"}
                async with httpx.AsyncClient(timeout=10.0) as http_client:
                    delete_resp = await http_client.delete(f"https://api.freestyle.sh/git/v1/repo/{created_repo_id}", headers=headers)
                    if delete_resp.status_code in (200, 204, 404):
                        logger.info(f"Successfully rolled back repository {created_repo_id}")
                    else:
                        logger.warning(f"Rollback failed: {delete_resp.status_code} {delete_resp.text}")
            except Exception as rollback_error:
                logger.error(f"Rollback failed: {rollback_error}")
        
        raise HTTPException(status_code=500, detail="Error creating Freestyle repository")


@router.post("/project/{project_id}/deploy/git")
async def deploy_from_git(
    project_data: Tuple[Dict[str, Any], str, str] = Depends(get_validated_project_with_quota_check),
    body: Dict[str, Any] = None,
):
    """Initial deploy: ensure repo, push from Daytona, trigger Freestyle deploy from git.
    Body: { domains: string[], dir?: string, build?: bool, entrypoint?: string }
    Note: branch is hardcoded to 'main' and auto-deploy is always enabled.
    """
    if not config.FREESTYLE_API_KEY:
        raise HTTPException(status_code=500, detail="Freestyle API key not configured")

    project, account_id, user_id = project_data
    project_id = project['project_id']
    client = await db.client
    # Note: account_id is already extracted from project['user_id'] by get_validated_project_with_quota_check

    sandbox_info = project.get('sandbox') or {}
    sandbox_id = (sandbox_info or {}).get('id') if isinstance(sandbox_info, dict) else None
    if not sandbox_id:
        raise HTTPException(status_code=404, detail="Project sandbox not found")

    # Ensure freestyle repo
    repo_resp = await ensure_freestyle_repo(project)
    repo_url = repo_resp['repo_url']
    repo_id = repo_resp.get('repo_id')

    # Fixed deployment settings
    branch = 'main'  # Always use main branch
    auto_push = True  # Always enable auto-deploy on push
    
    # Generate default Freestyle domain from project name
    def generate_default_domain(project_name: str) -> str:
        """Generate a default .style.dev domain from project name"""
        import re
        # Convert to lowercase and replace spaces/special chars with hyphens
        domain_name = re.sub(r'[^a-zA-Z0-9\s-]', '', project_name.lower())
        domain_name = re.sub(r'\s+', '-', domain_name.strip())
        # Remove multiple consecutive hyphens
        domain_name = re.sub(r'-+', '-', domain_name)
        # Remove leading/trailing hyphens
        domain_name = domain_name.strip('-')
        # Limit length and ensure it's valid
        domain_name = domain_name[:50] if domain_name else 'my-app'
        return f"{domain_name}.style.dev"
    
    # User-configurable options with default domain
    user_domains = body.get('domains') or []
    
    # If no domains provided, generate default Freestyle domain
    if not user_domains:
        default_domain = generate_default_domain(project.get('name', 'my-app'))
        domains = [default_domain]
    else:
        domains = user_domains
    
    dir_opt = body.get('dir')
    entrypoint_opt = body.get('entrypoint')

    # Prepare Daytona sandbox for push
    sandbox = await get_or_start_sandbox(sandbox_id)
    workdir = '/workspace/cheatcode-app'

    try:
        # Always get a fresh token and set the remote URL to ensure valid credentials
        identity, token = await _ensure_git_identity_and_token(repo_id, project.get('name', f"project-{project_id}"))
        safe_url = f"https://x-access-token:{token}@git.freestyle.sh/{repo_id}"

        # Check if git is initialized and has commits using native SDK
        has_commits = await _git_has_commits(sandbox, workdir)
        logger.info(f"Git repository status - has_commits: {has_commits}")

        if not has_commits:
            logger.info("Initializing Git repository and pushing initial commit")

            # Initialize and set basic config
            init_result = await sandbox.process.exec(f"git -C {workdir} init -b main", timeout=20)
            if init_result.exit_code != 0:
                logger.error(f"Git init failed: {init_result.result}")
                raise Exception("Failed to initialize Git repository")

            await sandbox.process.exec(f'git -C {workdir} config user.name "cheatcode"', timeout=10)
            await sandbox.process.exec(f'git -C {workdir} config user.email "deploy@cheatcode"', timeout=10)

            # Add remote (idempotent: if origin exists, set-url instead)
            remote_result = await sandbox.process.exec(f"git -C {workdir} remote add origin {safe_url}", timeout=20)
            if remote_result.exit_code != 0:
                logger.warning(f"git remote add failed, attempting set-url: {remote_result.result}")
                set_url_result = await sandbox.process.exec(f"git -C {workdir} remote set-url origin {safe_url}", timeout=20)
                if set_url_result.exit_code != 0:
                    logger.error(f"Failed to configure Git remote: {set_url_result.result}")
                    raise Exception("Failed to configure Git remote")

            # Stage all files using native SDK
            try:
                await sandbox.git.add(workdir, ["."])
                logger.info("Files staged successfully")
            except Exception as add_error:
                logger.error(f"Git add failed: {add_error}")
                raise Exception("Failed to add files to Git")

            # Verify staging using native SDK status
            try:
                status = await sandbox.git.status(workdir)
                has_staged = bool(status.file_status and len(status.file_status) > 0)
                logger.info(f"Staged files count: {len(status.file_status) if status.file_status else 0}")
                if not has_staged:
                    logger.error("No files staged for commit - workspace may be empty")
                    raise Exception("No files to commit - workspace appears to be empty")
            except Exception as status_error:
                # If status fails but add succeeded, continue with commit
                logger.warning(f"Could not verify staging status: {status_error}")

            # Commit using native SDK
            try:
                commit_response = await sandbox.git.commit(
                    path=workdir,
                    message="Initial commit for deployment",
                    author="cheatcode",
                    email="deploy@cheatcode"
                )
                logger.info(f"Created initial commit: {commit_response.sha if hasattr(commit_response, 'sha') else 'success'}")
            except Exception as commit_error:
                logger.error(f"Git commit failed: {commit_error}")
                raise Exception("Failed to create initial commit")

            try:
                push_result = await sandbox.process.exec(f"git -C {workdir} push -u origin main --force", timeout=180)
                if push_result.exit_code == 0:
                    logger.info("Initial push completed")
                else:
                    logger.error(f"Failed to push to Git repo {repo_id}: {push_result.result}")
                    branch_result = await sandbox.process.exec(f"git -C {workdir} branch -a", timeout=10)
                    logger.error(f"Git branches: {branch_result.result}")
                    raise Exception(f"Git push failed with exit code {push_result.exit_code}")
            except Exception as push_error:
                # Clean up Freestyle repo metadata to avoid inconsistent state on next attempt
                try:
                    updated_sandbox = sandbox_info if isinstance(sandbox_info, dict) else {}
                    if 'freestyle' in updated_sandbox:
                        del updated_sandbox['freestyle']
                    await client.table('projects').update({'sandbox': updated_sandbox}).eq('project_id', project_id).eq('user_id', account_id).execute()
                    logger.info(f"Cleared Freestyle repo metadata for project {project_id} after push failure")
                except Exception as meta_err:
                    logger.warning(f"Failed to clear Freestyle metadata after push failure: {meta_err}")
                raise
        else:
            logger.info("Repository already initialized; updating remote credentials and pushing changes if any")
            # Ensure remote URL is set with fresh token
            await sandbox.process.exec(f"git -C {workdir} remote set-url origin {safe_url}", timeout=20)

            # Ensure we are on a local 'main' branch (handle detached HEAD or other branch names)
            try:
                # Create/switch to 'main' pointing at current HEAD
                checkout_result = await sandbox.process.exec(f"git -C {workdir} checkout -B main", timeout=20)
                if checkout_result.exit_code != 0:
                    logger.warning(f"Failed to checkout -B main: {checkout_result.result}")
                    # Fallback: try renaming current branch to main
                    rename_result = await sandbox.process.exec(f"git -C {workdir} branch -M main", timeout=20)
                    if rename_result.exit_code != 0:
                        logger.error(f"Failed to ensure local 'main' branch: {rename_result.result}")
                        raise Exception("Failed to ensure local 'main' branch exists")
            except Exception as ensure_main_err:
                logger.error(f"Error ensuring local 'main' branch: {ensure_main_err}")
                raise

            # Commit and push any changes using native SDK
            has_changes = await _git_has_changes(sandbox, workdir)
            if has_changes:
                # Stage and commit using native SDK
                commit_success = await _git_stage_and_commit(
                    sandbox, workdir,
                    message="Update: automated deployment",
                    author="cheatcode",
                    email="deploy@cheatcode"
                )
                if not commit_success:
                    raise Exception("Failed to stage and commit changes")
                try:
                    push_result = await sandbox.process.exec(f"git -C {workdir} push origin main --force", timeout=180)
                    if push_result.exit_code == 0:
                        logger.info("Pushed final changes to Git repo")
                    else:
                        logger.error(f"Failed to push updates to Git repo {repo_id}: {push_result.result}")
                        raise Exception(f"Git push failed with exit code {push_result.exit_code}")
                except Exception as push_error:
                    # Clean up Freestyle repo metadata to avoid inconsistent state on next attempt
                    try:
                        updated_sandbox = sandbox_info if isinstance(sandbox_info, dict) else {}
                        if 'freestyle' in updated_sandbox:
                            del updated_sandbox['freestyle']
                        await client.table('projects').update({'sandbox': updated_sandbox}).eq('project_id', project_id).eq('user_id', account_id).execute()
                        logger.info(f"Cleared Freestyle repo metadata for project {project_id} after push failure")
                    except Exception as meta_err:
                        logger.warning(f"Failed to clear Freestyle metadata after push failure: {meta_err}")
                    raise
            else:
                logger.info("No changes detected; forcing a push to ensure remote is in sync")
                try:
                    # Ensure we are on main before forcing push
                    await sandbox.process.exec(f"git -C {workdir} checkout -B main", timeout=20)
                    push_result = await sandbox.process.exec(f"git -C {workdir} push -u origin main --force", timeout=180)
                    if push_result.exit_code == 0:
                        logger.info("Force push completed (or already up-to-date)")
                    else:
                        logger.error(f"Force push failed: {push_result.result}")
                        raise Exception(f"Git push failed with exit code {push_result.exit_code}")
                except Exception as push_error:
                    # Clean up Freestyle repo metadata to avoid inconsistent state on next attempt
                    try:
                        updated_sandbox = sandbox_info if isinstance(sandbox_info, dict) else {}
                        if 'freestyle' in updated_sandbox:
                            del updated_sandbox['freestyle']
                        await client.table('projects').update({'sandbox': updated_sandbox}).eq('project_id', project_id).eq('user_id', account_id).execute()
                        logger.info(f"Cleared Freestyle repo metadata for project {project_id} after push failure")
                    except Exception as meta_err:
                        logger.warning(f"Failed to clear Freestyle metadata after push failure: {meta_err}")
                    raise
    
    except Exception as e:
        logger.error(f"Git operations failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to prepare repository for deployment")

    # Trigger Freestyle deploy from git
    try:
        import freestyle as fs
        
        # Log SDK version for debugging
        logger.info(f"Freestyle SDK version: {getattr(fs, '__version__', 'unknown')}")
        
        # Validate API key exists
        if not config.FREESTYLE_API_KEY:
            raise Exception("Freestyle API key is not configured")
        
        # Log API key presence (but not the actual key for security)
        api_key_prefix = config.FREESTYLE_API_KEY[:8] + "..." if len(config.FREESTYLE_API_KEY) > 8 else "short_key"
        logger.info(f"Freestyle API key configured: {api_key_prefix}")
        
        client_fs = fs.Freestyle(config.FREESTYLE_API_KEY)
        
        # Test API connectivity (if available)
        try:
            # Some Freestyle SDKs have a health check or list method
            if hasattr(client_fs, 'list_web_deploys'):
                logger.info("Testing Freestyle API connectivity...")
                # This should fail fast if auth is wrong
                test_result = client_fs.list_web_deploys(limit=1, offset=0)
                logger.info("Freestyle API connectivity test passed")
            else:
                logger.info("No API connectivity test available - proceeding with deployment")
        except Exception as connectivity_error:
            logger.error(f"Freestyle API connectivity test failed: {connectivity_error}")
            logger.error("This suggests authentication or API service issues")
            # Don't fail here - maybe the list method has different auth but deploy works
        
        # Validate Git repository URL format
        if not repo_url or not repo_url.startswith('https://'):
            raise Exception(f"Invalid Git repository URL: {repo_url}")
        
        # Log Git repository details for debugging
        logger.info(f"Git repository URL: {repo_url}")
        logger.info(f"Git branch: {branch}")
        
        # Create deployment source - correct usage per documentation
        src_dict = {
            'kind': 'git',
            'url': repo_url,
            'branch': branch
        }
        
        # Add dir parameter if specified (per Freestyle docs)
        if dir_opt:
            src_dict['dir'] = dir_opt
            
        logger.info(f"Creating deployment source with: {src_dict}")
        
        try:
            src = fs.DeploymentSource.from_dict(src_dict)
            logger.info("Successfully created deployment source")
        except Exception as src_error:
            logger.error(f"Failed to create deployment source: {src_error}")
            raise Exception(f"Invalid deployment source configuration: {str(src_error)}")
        
        # Create deployment config for Next.js webapp
        config_dict = {'domains': domains}
        
        # Since we know this is always a Next.js app using our template, be explicit
        # Set build to true to trigger Next.js build process
        try:
            config_dict['build'] = fs.DeploymentBuildOptions.from_dict(True)
            logger.info("Set build=True for Next.js project")
        except Exception as build_error:
            logger.warning(f"Failed to create build options: {build_error}")
            config_dict['build'] = True
            logger.info("Using simple build=True fallback")
        
        # For Next.js standalone builds, set the correct entrypoint
        # Freestyle extracts the .next/standalone directory, so the entrypoint is just 'server.js'
        if not entrypoint_opt:
            config_dict['entrypoint'] = 'server.js'
            logger.info("Set Next.js standalone entrypoint: server.js")
        else:
            config_dict['entrypoint'] = entrypoint_opt
            logger.info(f"Using custom entrypoint: {entrypoint_opt}")
            
        logger.info(f"Creating deployment config with: {config_dict}")
        cfg = fs.FreestyleDeployWebConfiguration(**config_dict)
        
        logger.info(f"Starting Freestyle deployment for repo: {repo_url}, branch: {branch}, domains: {domains}")
        
        # Call Freestyle API with error handling
        try:
            resp = client_fs.deploy_web(src=src, config=cfg)
        except Exception as api_error:
            logger.error(f"Freestyle API call failed: {api_error}")
            logger.error(f"API error type: {type(api_error)}")
            
            # Check if this is a Pydantic validation error (response with null values)
            if 'ValidationError' in str(type(api_error)) or 'validation errors' in str(api_error):
                logger.error("This appears to be a Pydantic validation error - Freestyle API returned null values")
                
                # Try to get the raw response data from the error
                if hasattr(api_error, 'input') or hasattr(api_error, 'model_json_schema'):
                    logger.error(f"Validation error details: {api_error}")
                
                # This suggests the Freestyle API returned an error but with wrong schema
                error_msg = f"""Freestyle deployment failed: API returned invalid response with null values.

Common causes and solutions:
1. **Authentication Issue**: Check if Freestyle API key is valid and not expired
2. **Repository Access**: Ensure Freestyle can access the Git repository at {repo_url}
3. **Empty Repository**: Verify the repository has commits and contains valid application code
4. **Build Configuration**: Check if the repository has a valid framework setup (package.json, etc.)
5. **Freestyle Service**: Their API might be experiencing issues

Repository details:
- URL: {repo_url}
- Branch: {branch}
- Domain: {domains}

Original validation error: {str(api_error)}"""
                raise Exception(error_msg)
            
            if hasattr(api_error, 'response'):
                logger.error(f"API error response: {api_error.response}")
            raise Exception(f"Freestyle deployment API call failed: {str(api_error)}")
        logger.info(f"Freestyle deploy_web response: {resp}")
        logger.info(f"Response type: {type(resp)}")
        logger.info(f"Response attributes: {dir(resp)}")
        
        # Extract deployment information from response
        # According to Freestyle docs, the response should be FreestyleDeployWebSuccessResponseV2
        deployment_id = None
        api_project_id = None  # This is from Freestyle API response (often contains deployment_id), NOT our actual project_id
        entrypoint = None
        
        # Log full response structure for debugging
        logger.info(f"Response object type: {type(resp)}")
        logger.info(f"Response object: {resp}")
        
        # Try to access response as object attributes first
        try:
            if hasattr(resp, 'deployment_id'):
                deployment_id = resp.deployment_id
            if hasattr(resp, 'deploymentId'):
                deployment_id = resp.deploymentId
            if hasattr(resp, 'project_id'):
                api_project_id = resp.project_id
            if hasattr(resp, 'projectId'): 
                api_project_id = resp.projectId
            if hasattr(resp, 'entrypoint'):
                entrypoint = resp.entrypoint
                
            logger.info(f"Extracted from attributes - deployment_id: {deployment_id}, api_project_id: {api_project_id}, entrypoint: {entrypoint}")
        except Exception as attr_error:
            logger.warning(f"Error accessing response attributes: {attr_error}")
        
        # Try to access response as dictionary
        if isinstance(resp, dict):
            deployment_id = deployment_id or resp.get('deployment_id') or resp.get('deploymentId')
            api_project_id = api_project_id or resp.get('project_id') or resp.get('projectId')
            entrypoint = entrypoint or resp.get('entrypoint')
            logger.info(f"Extracted from dict - deployment_id: {deployment_id}, api_project_id: {api_project_id}, entrypoint: {entrypoint}")
        
        # If response has __dict__, try that
        if hasattr(resp, '__dict__') and resp.__dict__:
            resp_dict = resp.__dict__
            logger.info(f"Response __dict__: {resp_dict}")
            deployment_id = deployment_id or resp_dict.get('deployment_id') or resp_dict.get('deploymentId')
            api_project_id = api_project_id or resp_dict.get('project_id') or resp_dict.get('projectId') 
            entrypoint = entrypoint or resp_dict.get('entrypoint')
            logger.info(f"Extracted from __dict__ - deployment_id: {deployment_id}, api_project_id: {api_project_id}, entrypoint: {entrypoint}")
        
        # Check if this might be an error response disguised as success
        if hasattr(resp, 'message') and resp.message:
            error_message = resp.message
            logger.error(f"Freestyle API returned error in success response: {error_message}")
            raise Exception(f"Freestyle deployment failed: {error_message}")
        
        # Check for dict-style error response
        if isinstance(resp, dict) and 'message' in resp and not deployment_id:
            error_message = resp['message']
            logger.error(f"Freestyle API returned error response: {error_message}")
            raise Exception(f"Freestyle deployment failed: {error_message}")
        
        # Final validation
        if not deployment_id:
            # Log all available attributes for debugging
            logger.error("Failed to extract deployment_id. Available attributes:")
            for attr in dir(resp):
                if not attr.startswith('_'):
                    try:
                        value = getattr(resp, attr)
                        logger.error(f"  {attr}: {value} (type: {type(value)})")
                    except Exception as e:
                        logger.error(f"  {attr}: <error accessing: {e}>")
            
            # Check if the response might indicate a validation error
            error_indicators = ['error', 'fail', 'invalid', 'validation']
            resp_str = str(resp).lower()
            for indicator in error_indicators:
                if indicator in resp_str:
                    raise Exception(f"Freestyle deployment failed with validation error. Response: {resp}")
            
            raise Exception(f"Failed to extract deployment_id from Freestyle API response. This might indicate a deployment failure. Response type: {type(resp)}, Response: {resp}")
        
        logger.info(f"Successfully extracted deployment_id: {deployment_id}")

        # Persist deployment metadata - include account_id for security
        try:
            updated_sandbox = sandbox_info if isinstance(sandbox_info, dict) else {}
            updated_freestyle = (updated_sandbox.get('freestyle') or {})
            updated_freestyle.update({
                'branch': branch,
                'domains': domains,
                'auto_deploy_on_push': auto_push,
                'last_deployment_id': deployment_id,
            })
            updated_sandbox['freestyle'] = updated_freestyle
            
            logger.info(f"Attempting to update project {project_id} with deployment metadata")
            logger.debug(f"Updated sandbox data: {updated_sandbox}")
            
            result = await client.table('projects').update({'sandbox': updated_sandbox}).eq('project_id', project_id).eq('user_id', account_id).execute()
            
            update_succeeded = bool(result.data)
            
            if not update_succeeded:
                # Try alternative update method using JSONB functions
                logger.warning(f"Standard update failed, trying JSONB-specific update for project {project_id}")
                try:
                    # Use PostgreSQL JSONB functions for more reliable nested updates
                    alternative_result = await client.rpc('update_project_deployment_metadata', {
                        'project_id_param': project_id,
                        'account_id_param': account_id,
                        'deployment_id_param': deployment_id,
                        'domains_param': domains,
                        'branch_param': branch,
                        'auto_deploy_param': auto_push
                    }).execute()
                    
                    if alternative_result.data:
                        logger.info(f"Alternative JSONB update succeeded for project {project_id}")
                        update_succeeded = True
                except Exception as alt_error:
                    logger.error(f"Alternative update method also failed: {str(alt_error)}")
            
            if not update_succeeded:
                # Check if the project exists with different user_id
                check_result = await client.table('projects').select('project_id, user_id').eq('project_id', project_id).execute()
                if check_result.data:
                    actual_user_id = check_result.data[0].get('user_id')
                    logger.error(f"User ID mismatch - expected: {account_id}, actual: {actual_user_id}")
                else:
                    logger.error(f"Project {project_id} not found in database")
                
                logger.critical(
                    f"CRITICAL: Failed to persist deployment metadata for project {project_id} "
                    f"and deployment {deployment_id}. The deployment is running but the UI may be out of sync. "
                    f"Manual intervention required to update project {project_id} with deployment_id {deployment_id}."
                )
            else:
                logger.info(f"Successfully persisted deployment metadata for project {project_id}")
                
        except Exception as persist_error:
            logger.error(f"Exception during deployment metadata persistence: {str(persist_error)}")
            logger.critical(
                f"CRITICAL: Exception while persisting deployment metadata for project {project_id} "
                f"and deployment {deployment_id}. Error: {str(persist_error)}. "
                f"The deployment is running but the UI may be out of sync."
            )
            # Note: We don't rollback the deployment here as it may have already started successfully
            # and stopping it could cause more harm than good. The deployment will proceed but the UI
            # will show stale information until manually corrected.

        return {
            'deploymentId': deployment_id,
            'domains': domains,
            'repoUrl': repo_url,
            'branch': branch,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Freestyle deploy_web failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to start Freestyle deployment")


@router.post("/project/{project_id}/deploy/git/update")
async def update_deployment(
    project: Dict[str, Any] = Depends(get_validated_project),
    user_id: str = Depends(get_current_user_id_from_jwt),
):
    """Update deployment: git add/commit/push; rely on auto-deploy on push if enabled, else call deploy again."""
    if not config.FREESTYLE_API_KEY:
        raise HTTPException(status_code=500, detail="Freestyle API key not configured")

    project_id = project['project_id']
    account_id = project['user_id']
    client = await db.client
    sandbox_info = project.get('sandbox') or {}
    sandbox_id = (sandbox_info or {}).get('id') if isinstance(sandbox_info, dict) else None
    if not sandbox_id:
        raise HTTPException(status_code=404, detail="Project sandbox not found")

    freestyle = (sandbox_info.get('freestyle') or {}) if isinstance(sandbox_info, dict) else {}
    repo_url = freestyle.get('repo_url')
    repo_id = freestyle.get('repo_id')
    branch = freestyle.get('branch', 'main')
    auto_push = freestyle.get('auto_deploy_on_push', True)
    domains = freestyle.get('domains', [])

    if not repo_url:
        raise HTTPException(status_code=400, detail="Freestyle repo not initialized for this project")

    sandbox = await get_or_start_sandbox(sandbox_id)
    workdir = '/workspace/cheatcode-app'

    # Updates don't count against quota - only initial deployments do

    # Add/commit/push if changes - using native SDK methods where possible
    has_changes = False
    try:
        # Check git status using native SDK
        has_changes = await _git_has_changes(sandbox, workdir)
        logger.info(f"Update deployment - changes detected: {has_changes}")

        if has_changes:
            if not repo_id:
                raise HTTPException(status_code=500, detail="Missing repository ID for Freestyle repo")
            identity, token = await _ensure_git_identity_and_token(repo_id, project.get('name', f"project-{project_id}"))

            # Stage and commit using native SDK
            commit_success = await _git_stage_and_commit(
                sandbox, workdir,
                message="Update: automated deployment",
                author="cheatcode",
                email="deploy@cheatcode"
            )
            if not commit_success:
                raise Exception("Failed to stage and commit changes")

            # Set remote URL with credentials (no native SDK equivalent for remote management)
            safe_url = f"https://x-access-token:{token}@git.freestyle.sh/{repo_id}"
            await sandbox.process.exec(f"git -C {workdir} remote set-url origin {safe_url}", timeout=20)

            # Push using shell command (native SDK doesn't support branch specification)
            push_result = await sandbox.process.exec(f"git -C {workdir} push origin {branch}", timeout=180)
            if push_result.exit_code == 0:
                logger.info("Update committed and pushed successfully")
            else:
                logger.error(f"Failed to push updates to Git repo {repo_id}: {push_result.result}")
                raise Exception(f"Git push failed with exit code {push_result.exit_code}")
        else:
            logger.info("No changes detected - skipping commit/push, but will still trigger redeploy")
    except Exception as e:
        # Only fail if we had changes but couldn't push them
        # If no changes, we still want to trigger a redeploy
        if has_changes:
            logger.error(f"Git update push failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to push updates to Freestyle Git repository")
        else:
            logger.warning(f"Git operations failed but no changes detected, continuing with redeploy: {e}")

    # Always trigger a new deployment after pushing changes
    # This ensures the latest code is properly built and deployed
    try:
        import freestyle as fs
        client_fs = fs.Freestyle(config.FREESTYLE_API_KEY)
        src = fs.DeploymentSource.from_dict({
            'kind': 'git',
            'url': repo_url,
            'branch': branch
        })
        cfg = fs.FreestyleDeployWebConfiguration(
            domains=domains,
            build=fs.DeploymentBuildOptions.from_dict(True),
            entrypoint='server.js'  # Next.js standalone entrypoint (relative to extracted .next/standalone dir)
        )
        resp = client_fs.deploy_web(src=src, config=cfg)
        deployment_id = getattr(resp, 'deployment_id', None) or getattr(resp, 'deploymentId', None)
        
        # Update database with new deployment_id if we got one
        if deployment_id:
            try:
                updated_freestyle = (sandbox_info.get('freestyle') or {})
                updated_freestyle['last_deployment_id'] = deployment_id
                updated_sandbox = sandbox_info if isinstance(sandbox_info, dict) else {}
                updated_sandbox['freestyle'] = updated_freestyle
                
                result = await client.table('projects').update({'sandbox': updated_sandbox}).eq('project_id', project_id).eq('user_id', account_id).execute()
                if not result.data:
                    logger.critical(
                        f"CRITICAL: Failed to persist updated deployment metadata for project {project_id} "
                        f"and deployment {deployment_id}. The deployment is running but the UI may be out of sync. "
                        f"Manual intervention required to update project {project_id} with deployment_id {deployment_id}."
                    )
            except Exception as e:
                logger.critical(
                    f"CRITICAL: Exception while persisting deployment metadata for project {project_id} "
                    f"and deployment {deployment_id}: {e}. Manual intervention required."
                )
        
        return { 'deploymentId': deployment_id, 'status': 'ok', 'message': 'Redeployment triggered successfully' }
    except Exception as e:
        logger.error(f"Redeployment failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to trigger redeployment")


@router.get("/project/{project_id}/deployment/status")
async def get_deployment_status(
    project: Dict[str, Any] = Depends(get_validated_project),
):
    """Get the deployment status for a project.
    Returns: { has_deployment: bool, domains: string[], repo_url: string?, last_deployment_id: string?, branch: string? }
    """
    sandbox_info = project.get('sandbox') or {}
    freestyle = (sandbox_info.get('freestyle') or {}) if isinstance(sandbox_info, dict) else {}

    # Use computed column for faster deployment status check
    has_deployment = project.get('has_freestyle_deployment', False)
    
    return {
        "has_deployment": has_deployment,
        "domains": freestyle.get('domains', []),
        "repo_url": freestyle.get('repo_url'),
        "last_deployment_id": freestyle.get('last_deployment_id'),
        "branch": freestyle.get('branch', 'main'),
        "auto_deploy_on_push": freestyle.get('auto_deploy_on_push', True),
        # Include app_type so the frontend can hide deploy UI for mobile projects
        "app_type": project.get('app_type', 'web'),
    }


@router.get("/project/{project_id}/git/files")
async def list_git_files(
    project_id: str,
    path: str = "",
    project: Dict[str, Any] = Depends(get_validated_project),
):
    """List files from the project's Git repository using Git operations."""
    try:
        # Get sandbox and freestyle info
        sandbox_info = project.get('sandbox', {})
        freestyle_info = sandbox_info.get('freestyle', {})
        repo_id = freestyle_info.get('repo_id')
        sandbox_id = sandbox_info.get('id')
        
        if not sandbox_id:
            raise HTTPException(status_code=404, detail="No sandbox available for Git operations")
        
        if not repo_id:
            # No Git repo initialized yet - return empty list
            return {"success": True, "files": [], "source": "git", "message": "Git repository not initialized"}
        
        from sandbox.api import get_or_start_sandbox
        sandbox = await get_or_start_sandbox(sandbox_id)
        workdir = "/workspace/cheatcode-app"
        
        # Use Git ls-tree to list files from the Git repository
        try:
            # Normalize path for Git
            git_path = path.strip('/') if path.strip('/') else '.'
            
            # List files using git ls-tree (shows only committed files)
            ls_tree_cmd = f"git -C {workdir} ls-tree HEAD:{git_path}" if git_path != '.' else f"git -C {workdir} ls-tree HEAD"
            ls_result = await sandbox.process.exec(ls_tree_cmd, timeout=30)
            
            if ls_result.exit_code == 0:
                files = []
                for line in ls_result.result.strip().split('\n'):
                    if line:
                        # Parse git ls-tree output: mode type hash name
                        parts = line.split('\t')
                        if len(parts) >= 2:
                            meta_parts = parts[0].split()
                            if len(meta_parts) >= 3:
                                mode, obj_type, hash_val = meta_parts[0], meta_parts[1], meta_parts[2]
                                name = parts[1]
                                
                                # Build the relative path
                                if git_path == '.':
                                    rel_path = name
                                else:
                                    rel_path = f"{git_path}/{name}" if git_path else name
                                
                                files.append({
                                    "name": name,
                                    "path": rel_path,
                                    "is_dir": obj_type == "tree",
                                    "size": 0,  # Git doesn't provide size in ls-tree
                                    "mod_time": "",  # Would need git log for this
                                    "mode": mode,
                                    "hash": hash_val
                                })
                
                return {"success": True, "files": files, "source": "git"}
            else:
                # Path doesn't exist in Git or no commits yet
                if "fatal: not a tree object" in ls_result.result or "fatal: Not a valid object name" in ls_result.result:
                    return {"success": True, "files": [], "source": "git", "message": "Path not found in Git repository"}
                else:
                    logger.warning(f"Git ls-tree failed: {ls_result.result}")
                    return {"success": True, "files": [], "source": "git", "error": "Failed to list Git repository contents"}
                    
        except Exception as e:
            logger.error(f"Failed to list files from Git repository: {e}")
            raise HTTPException(status_code=500, detail=f"Git operation failed: {str(e)}")
        
    except Exception as e:
        logger.error(f"Failed to list Git files for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to list repository files")


@router.get("/project/{project_id}/git/file-content")
async def get_git_file_content(
    project_id: str,
    file_path: str,
    project: Dict[str, Any] = Depends(get_validated_project),
):
    """Get file content from the project's Git repository using Git operations."""
    try:
        # Get sandbox and freestyle info
        sandbox_info = project.get('sandbox', {})
        freestyle_info = sandbox_info.get('freestyle', {})
        repo_id = freestyle_info.get('repo_id')
        sandbox_id = sandbox_info.get('id')
        
        if not sandbox_id:
            raise HTTPException(status_code=404, detail="No sandbox available for Git operations")
        
        if not repo_id:
            raise HTTPException(status_code=404, detail="Git repository not initialized")
        
        from sandbox.api import get_or_start_sandbox
        sandbox = await get_or_start_sandbox(sandbox_id)
        workdir = "/workspace/cheatcode-app"
        
        # Use Git show to get file content from the Git repository
        try:
            # Normalize file path for Git
            git_file_path = file_path.strip('/')
            
            # Get file content using git show (reads from Git, not filesystem)
            show_cmd = f"git -C {workdir} show HEAD:{git_file_path}"
            content_result = await sandbox.process.exec(show_cmd, timeout=30)
            
            if content_result.exit_code == 0:
                return {
                    "success": True,
                    "content": content_result.result,
                    "source": "git",
                    "file_path": git_file_path
                }
            else:
                # Check if it's a "file not found" vs other Git error
                if "fatal: path" in content_result.result and "does not exist" in content_result.result:
                    raise HTTPException(status_code=404, detail=f"File '{git_file_path}' not found in Git repository")
                elif "fatal: Invalid object name" in content_result.result:
                    raise HTTPException(status_code=404, detail="No commits found in repository")
                else:
                    logger.warning(f"Git show failed for {git_file_path}: {content_result.result}")
                    raise HTTPException(status_code=500, detail="Failed to read file from Git repository")
                    
        except HTTPException:
            # Re-raise HTTP exceptions without wrapping
            raise
        except Exception as e:
            logger.error(f"Failed to read file {file_path} from Git repository: {e}")
            raise HTTPException(status_code=500, detail=f"Git operation failed: {str(e)}")
        
    except Exception as e:
        logger.error(f"Failed to get Git file content for project {project_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get file content")


