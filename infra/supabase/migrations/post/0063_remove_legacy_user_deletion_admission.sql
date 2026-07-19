drop function public.webhooks_list_due_user_deletions(timestamp with time zone, integer);

-- The steady-state ACL reset in 0061 intentionally runs after every expansion.
-- Restore only the reviewed account-deletion job surface introduced by 0062.
grant select, insert, delete on table public.v2_user_deletion_jobs to app_webhooks;
grant update (
  continuation,
  cursor,
  failure_count,
  last_error_code,
  lease_expires_at,
  lease_token,
  next_attempt_at,
  phase,
  status
) on table public.v2_user_deletion_jobs to app_webhooks;

grant execute on function
  public.webhooks_discover_user_deletion_jobs(timestamp with time zone, integer),
  public.webhooks_claim_ready_user_deletion_jobs(uuid, integer, integer, timestamp with time zone)
to app_webhooks;
