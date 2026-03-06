"""All Inngest functions registered for the Cheatcode backend.

Import this module in main.py to register all functions with the serve handler.
"""

from inngest_functions.agent_run import process_agent_run
from inngest_functions.deployments import deploy_to_vercel
from inngest_functions.email import send_email_notification
from inngest_functions.finalize_agent_run import finalize_agent_run
from inngest_functions.scheduled import (
    aggregate_daily_usage,
    cleanup_stale_locks,
    cleanup_stale_redis_keys,
    reconcile_stale_runs,
)
from inngest_functions.webhooks import process_polar_webhook

# All functions to register with inngest.fast_api.serve()
ALL_FUNCTIONS = [
    process_agent_run,
    finalize_agent_run,
    process_polar_webhook,
    deploy_to_vercel,
    send_email_notification,
    cleanup_stale_redis_keys,
    cleanup_stale_locks,
    reconcile_stale_runs,
    aggregate_daily_usage,
]
