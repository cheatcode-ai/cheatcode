-- Drop retired V2 product surfaces that have no external resource ownership.
-- Generated outputs, projects, and integrations are deliberately absent here:
-- their R2, Daytona, and Composio cleanup is handled by deployed workflows.
drop table if exists public.v2_scheduled_run_history restrict;
drop table if exists public.v2_scheduled_agents restrict;
drop table if exists public.v2_notifications restrict;
drop table if exists public.v2_push_subscriptions restrict;
drop table if exists public.v2_usage_daily_totals restrict;
drop table if exists public.v2_usage_events restrict;

drop trigger if exists trg_v2_users_updated on public.v2_users;

alter table public.v2_users
  drop column if exists updated_at;

alter table public.v2_user_profiles
  drop column if exists created_at;

alter table public.v2_deleted_clerk_identities
  drop column if exists deleted_at;

alter table public.v2_agent_runs
  drop column if exists share_token,
  drop column if exists error;

alter table public.v2_projects
  drop column if exists archived_pending_action,
  drop column if exists workspace_cleanup_requested_at,
  drop column if exists workspace_cleanup_completed_at;

alter table public.v2_entitlements
  drop column if exists max_projects,
  drop column if exists quota_sandbox_hours,
  drop column if exists quota_scheduled_runs,
  drop column if exists quota_composio_calls;

-- Workflow generations cross the Worker boundary as JavaScript Dates. Store
-- the same millisecond precision in Postgres so a retry can compare the exact
-- immutable generation instead of losing server-side microseconds in transit.
alter table public.v2_projects
  alter column deleted_at type timestamptz(3)
  using date_trunc('milliseconds', deleted_at);

alter table public.v2_threads
  alter column deleted_at type timestamptz(3)
  using date_trunc('milliseconds', deleted_at);

-- The keyset indexes are the only listing paths retained by the current code.
drop index if exists public.v2_projects_user_created_idx;
drop index if exists public.v2_threads_user_project_created_idx;
drop index if exists public.v2_threads_project_created_idx;
drop index if exists public.v2_messages_thread_created_idx;
drop index if exists public.v2_messages_user_created_idx;
drop index if exists public.v2_threads_user_recent_idx;
drop index if exists public.v2_user_skills_user_idx;

create index v2_projects_deletion_queue_idx
  on public.v2_projects (deleted_at, id)
  where deleted_at is not null;

create index v2_threads_project_delete_idx
  on public.v2_threads (user_id, project_id, id);

create index v2_threads_deletion_queue_idx
  on public.v2_threads (deleted_at, id)
  where deleted_at is not null;

create index v2_agent_runs_thread_delete_page_idx
  on public.v2_agent_runs (user_id, thread_id, id);

-- Replace the historical blanket CRUD grant with the least-privilege set used
-- by the current query modules. Column-level billing SELECT is intentional:
-- retention and deletion need identity/timestamps, never webhook payloads.
revoke all on table
  public._audit_archive_manifest,
  public._raw_migrations,
  public.v2_agent_runs,
  public.v2_audit_log,
  public.v2_billing_events,
  public.v2_deleted_clerk_identities,
  public.v2_entitlements,
  public.v2_generated_outputs,
  public.v2_messages,
  public.v2_projects,
  public.v2_provider_keys,
  public.v2_threads,
  public.v2_user_integrations,
  public.v2_user_profiles,
  public.v2_user_skills,
  public.v2_users
from app_worker;

grant select, insert, update on table
  public.v2_agent_runs,
  public.v2_entitlements,
  public.v2_user_profiles
to app_worker;

grant select, insert on table public.v2_messages to app_worker;

grant select, insert, delete on table public.v2_generated_outputs to app_worker;

grant select, insert, update, delete on table
  public.v2_projects,
  public.v2_threads,
  public.v2_user_integrations,
  public.v2_user_skills,
  public.v2_users
to app_worker;

grant insert, update, delete on table public.v2_billing_events to app_worker;
grant select (id, processed_at, user_id) on table public.v2_billing_events to app_worker;

grant select, insert on table public.v2_deleted_clerk_identities to app_worker;

grant select on table public.v2_provider_keys to app_worker;
grant update (
  disabled_at,
  disabled_reason,
  last_revalidated_at,
  revalidation_claimed_at,
  revalidation_lease_token
) on table public.v2_provider_keys to app_worker;
