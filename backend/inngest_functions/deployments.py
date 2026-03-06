"""Durable deployment pipeline via Inngest.

Each step is independently retryable. If Vercel returns a transient error,
only the push step retries -- file collection and validation are memoized.
"""

from datetime import timedelta

import inngest

from services.inngest_client import inngest_client
from utils.logger import logger


async def _on_deployment_failure(ctx: inngest.Context) -> None:
    """Alert when a deployment permanently fails after all retries."""
    event_data = ctx.event.data.get("event", {}).get("data", {})
    project_id = event_data.get("project_id", "unknown")
    error_msg = ctx.event.data.get("error", {}).get("message", "unknown")

    logger.error(f"Deployment permanently failed: project={project_id} error={error_msg}")

    import sentry_sdk

    with sentry_sdk.push_scope() as scope:
        scope.set_tag("project_id", project_id)
        sentry_sdk.capture_message(f"Deployment failed: {project_id}", level="error")


@inngest_client.create_function(
    fn_id="deploy-to-vercel",
    trigger=inngest.TriggerEvent(event="deployment/requested"),
    retries=3,
    debounce=inngest.Debounce(
        period=timedelta(seconds=10),
        key="event.data.project_id",
    ),
    concurrency=[
        inngest.Concurrency(limit=5),
        inngest.Concurrency(limit=1, key="event.data.user_id"),
    ],
    on_failure=_on_deployment_failure,
)
async def deploy_to_vercel(ctx: inngest.Context) -> dict:
    project_id = ctx.event.data["project_id"]
    user_id = ctx.event.data["user_id"]
    sandbox_id = ctx.event.data["sandbox_id"]

    # Steps 1-2: Validate limits and get project info (parallel — independent)
    limits, project = await ctx.group.parallel(
        (
            lambda: ctx.step.run("validate-limits", _validate_deploy_limits, user_id),
            lambda: ctx.step.run("get-project", _get_project_info, project_id),
        )
    )

    # Step 3: Collect files from sandbox
    app_type = project.get("app_type", "web")
    files = await ctx.step.run("collect-files", _collect_sandbox_files, sandbox_id, app_type)

    if not files:
        raise Exception("No files found in workspace to deploy")

    # Step 4: Create Vercel deployment
    deployment = await ctx.step.run(
        "create-deployment", _create_vercel_deployment, project_id, project.get("name", ""), files
    )

    # Step 5: Save deployment record to database
    await ctx.step.run("save-record", _save_deployment_record, project_id, user_id, deployment)

    # Step 6: Notify completion
    await ctx.step.send_event(
        "notify-completion",
        inngest.Event(
            name="deployment/completed",
            data={
                "project_id": project_id,
                "user_id": user_id,
                "url": deployment.get("url"),
                "deployment_id": deployment.get("id"),
                "status": "deployed",
            },
        ),
    )

    return deployment


# ---- Helper Functions ----


async def _validate_deploy_limits(user_id: str) -> dict:
    """Check user's plan deployment limits."""
    from services.billing import get_user_subscription
    from services.supabase import DBConnection
    from utils.constants import get_plan_deployment_limit

    subscription = await get_user_subscription(user_id)
    plan_id = (subscription or {}).get("plan") or "free"
    max_deployed = get_plan_deployment_limit(plan_id)

    db = DBConnection()
    client = await db.client

    # Count existing deployments
    from utils.auth_utils import get_account_id_for_clerk_user

    account_id = await get_account_id_for_clerk_user(client, user_id)

    res = await client.table("projects").select("sandbox").eq("user_id", account_id).execute()
    current_deployed = 0
    for p in res.data or []:
        sandbox_info = p.get("sandbox") or {}
        if isinstance(sandbox_info, dict):
            vercel_meta = sandbox_info.get("vercel") or {}
            if isinstance(vercel_meta, dict) and vercel_meta.get("last_deployment_id"):
                current_deployed += 1

    if current_deployed >= max_deployed:
        raise Exception(f"Deployment limit reached. Your {plan_id} plan allows {max_deployed} deployed projects.")

    return {"allowed": True, "current": current_deployed, "max": max_deployed}


async def _get_project_info(project_id: str) -> dict:
    """Fetch project data from Supabase."""
    from services.supabase import DBConnection

    db = DBConnection()
    client = await db.client

    result = (
        await client.table("projects")
        .select("project_id, name, user_id, sandbox, app_type")
        .eq("project_id", project_id)
        .single()
        .execute()
    )

    if not result.data:
        raise Exception(f"Project {project_id} not found")

    return result.data


async def _collect_sandbox_files(sandbox_id: str, app_type: str) -> list:
    """Collect files from Daytona sandbox for Vercel deployment."""
    from sandbox.sandbox import get_or_start_sandbox
    from services.vercel_deploy import collect_files_for_vercel

    sandbox = await get_or_start_sandbox(sandbox_id)
    workdir = "/workspace/cheatcode-mobile" if app_type == "mobile" else "/workspace/cheatcode-app"
    files = await collect_files_for_vercel(sandbox, workdir)

    logger.info(f"Collected {len(files)} files from sandbox {sandbox_id}")
    return files


async def _create_vercel_deployment(project_id: str, project_name: str, files: list) -> dict:
    """Create Vercel deployment via API."""
    import re

    from services.vercel_deploy import VercelDeploymentService

    # Sanitize name for Vercel
    vercel_name = re.sub(r"[^a-z0-9-]", "-", project_name.lower())
    vercel_name = re.sub(r"-+", "-", vercel_name).strip("-")[:100]
    vercel_name = vercel_name or f"project-{project_id[:8]}"

    vercel = VercelDeploymentService()
    vercel_project = await vercel.ensure_project(vercel_name)

    deployment = await vercel.deploy_files(
        project_name=vercel_name,
        files=files,
        target="production",
    )

    deployment_id = deployment.get("id")
    deployment_url = deployment.get("url")

    if not deployment_id:
        raise Exception("Vercel API did not return a deployment ID")

    logger.info(f"Vercel deployment created: {deployment_id} -> {deployment_url}")

    return {
        "id": deployment_id,
        "url": deployment_url,
        "vercel_project_id": vercel_project.get("id"),
        "vercel_project_name": vercel_name,
    }


async def _save_deployment_record(project_id: str, user_id: str, deployment: dict) -> None:  # noqa: ARG001
    """Save deployment info to Supabase projects table."""
    from services.supabase import DBConnection

    db = DBConnection()
    client = await db.client

    # Fetch current sandbox info to merge
    result = await client.table("projects").select("sandbox").eq("project_id", project_id).single().execute()
    sandbox_info = (result.data or {}).get("sandbox") or {}

    updated_sandbox = dict(sandbox_info)
    updated_sandbox["vercel"] = {
        "project_id": deployment.get("vercel_project_id"),
        "project_name": deployment.get("vercel_project_name"),
        "last_deployment_id": deployment.get("id"),
        "url": deployment.get("url"),
        "domains": [deployment.get("url")],
    }

    await client.table("projects").update({"sandbox": updated_sandbox}).eq("project_id", project_id).execute()

    logger.info(f"Saved deployment record for project {project_id}")
