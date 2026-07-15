-- Pre-deploy-safe security and integrity expansion overlay. Drizzle owns table shape;
-- this file adds cross-tenant invariants, privileged audit functions, and resumable
-- operational retention state without removing application-facing schema.

do $$
declare
  violation_count bigint;
begin
  select count(*) into violation_count
    from public.v2_threads child
    left join public.v2_projects parent on parent.id = child.project_id
   where child.project_id is not null
     and (parent.id is null or parent.user_id <> child.user_id);
  if violation_count > 0 then
    raise exception 'tenant integrity preflight failed: % thread/project rows', violation_count;
  end if;

  select count(*) into violation_count
    from public.v2_messages child
    left join public.v2_threads parent on parent.id = child.thread_id
   where parent.id is null or parent.user_id <> child.user_id;
  if violation_count > 0 then
    raise exception 'tenant integrity preflight failed: % message/thread rows', violation_count;
  end if;

  select count(*) into violation_count
    from public.v2_messages child
    left join public.v2_agent_runs parent on parent.id = child.agent_run_id
   where child.agent_run_id is not null
     and (
       parent.id is null
       or parent.user_id <> child.user_id
       or parent.thread_id <> child.thread_id
     );
  if violation_count > 0 then
    raise exception 'tenant integrity preflight failed: % message/run rows', violation_count;
  end if;

  select count(*) into violation_count
    from public.v2_agent_runs child
    left join public.v2_threads parent on parent.id = child.thread_id
   where parent.id is null or parent.user_id <> child.user_id;
  if violation_count > 0 then
    raise exception 'tenant integrity preflight failed: % run/thread rows', violation_count;
  end if;

  select count(*) into violation_count
    from public.v2_threads child
    left join public.v2_agent_runs parent on parent.id = child.active_run_id
   where child.active_run_id is not null
     and (
       parent.id is null
       or parent.user_id <> child.user_id
       or parent.thread_id <> child.id
     );
  if violation_count > 0 then
    raise exception 'tenant integrity preflight failed: % thread/active-run rows', violation_count;
  end if;

  select count(*) into violation_count
    from public.v2_generated_outputs child
    left join public.v2_projects parent on parent.id = child.project_id
   where child.project_id is not null
     and (parent.id is null or parent.user_id <> child.user_id);
  if violation_count > 0 then
    raise exception 'tenant integrity preflight failed: % output/project rows', violation_count;
  end if;

  select count(*) into violation_count
    from public.v2_generated_outputs child
    left join public.v2_agent_runs parent on parent.id = child.agent_run_id
   where child.agent_run_id is not null
     and (parent.id is null or parent.user_id <> child.user_id);
  if violation_count > 0 then
    raise exception 'tenant integrity preflight failed: % output/run rows', violation_count;
  end if;

  select count(*) into violation_count
    from public.v2_generated_outputs
   where sha256 is null
      or sha256 !~ '^[0-9a-f]{64}$'
      or size_bytes <= 0
      or btrim(r2_bucket) = ''
      or length(r2_bucket) > 255
      or btrim(r2_key) = ''
      or length(r2_key) > 1024
      or btrim(filename) = ''
      or length(filename) > 255
      or btrim(mime_type) = ''
      or length(mime_type) > 255
      or kind not in ('audio', 'docx', 'image', 'pdf', 'slide', 'video', 'xlsx')
      or jsonb_typeof(metadata) <> 'object'
      or expires_at is null
      or expires_at <= created_at;
  if violation_count > 0 then
    raise exception 'output integrity preflight failed: % invalid output rows; backfill before retrying', violation_count;
  end if;

  select count(*) into violation_count
    from (
      select r2_bucket, r2_key
        from public.v2_generated_outputs
       group by r2_bucket, r2_key
      having count(*) > 1
    ) duplicates;
  if violation_count > 0 then
    raise exception 'output integrity preflight failed: % duplicate R2 object keys', violation_count;
  end if;

  -- This allowlist is the database counterpart of packages/types ProviderSchema.
  select count(*) into violation_count
    from public.v2_provider_keys
   where provider not in (
     'anthropic',
     'openai',
     'google',
     'openrouter',
     'deepseek',
     'exa',
     'firecrawl',
     'llamaparse'
   );
  if violation_count > 0 then
    raise exception 'provider key integrity preflight failed: % unknown providers', violation_count;
  end if;
end
$$;

alter table public.v2_projects
  add constraint v2_projects_id_user_id_key unique (id, user_id);
alter table public.v2_threads
  add constraint v2_threads_id_user_id_key unique (id, user_id);
alter table public.v2_agent_runs
  add constraint v2_agent_runs_id_user_id_key unique (id, user_id),
  add constraint v2_agent_runs_id_user_id_thread_id_key unique (id, user_id, thread_id);

alter table public.v2_threads
  add constraint v2_threads_project_user_fk
  foreign key (project_id, user_id)
  references public.v2_projects (id, user_id)
  on delete cascade;
alter table public.v2_messages
  add constraint v2_messages_thread_user_fk
  foreign key (thread_id, user_id)
  references public.v2_threads (id, user_id)
  on delete cascade;
alter table public.v2_messages
  add constraint v2_messages_agent_run_scope_fk
  foreign key (agent_run_id, user_id, thread_id)
  references public.v2_agent_runs (id, user_id, thread_id)
  on delete set null (agent_run_id);
alter table public.v2_agent_runs
  add constraint v2_agent_runs_thread_user_fk
  foreign key (thread_id, user_id)
  references public.v2_threads (id, user_id)
  on delete cascade;
alter table public.v2_threads
  add constraint v2_threads_active_run_scope_fk
  foreign key (active_run_id, user_id, id)
  references public.v2_agent_runs (id, user_id, thread_id)
  on delete set null (active_run_id);
alter table public.v2_generated_outputs
  add constraint v2_generated_outputs_project_user_fk
  foreign key (project_id, user_id)
  references public.v2_projects (id, user_id)
  on delete cascade;
alter table public.v2_generated_outputs
  add constraint v2_generated_outputs_agent_run_user_fk
  foreign key (agent_run_id, user_id)
  references public.v2_agent_runs (id, user_id)
  on delete set null (agent_run_id);

alter table public.v2_generated_outputs
  add constraint v2_generated_outputs_size_check check (size_bytes > 0),
  add constraint v2_generated_outputs_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  add constraint v2_generated_outputs_bucket_check
    check (btrim(r2_bucket) <> '' and length(r2_bucket) <= 255),
  add constraint v2_generated_outputs_key_check
    check (btrim(r2_key) <> '' and length(r2_key) <= 1024),
  add constraint v2_generated_outputs_filename_check
    check (btrim(filename) <> '' and length(filename) <= 255),
  add constraint v2_generated_outputs_mime_type_check
    check (btrim(mime_type) <> '' and length(mime_type) <= 255),
  add constraint v2_generated_outputs_kind_check
    check (kind in ('audio', 'docx', 'image', 'pdf', 'slide', 'video', 'xlsx')),
  add constraint v2_generated_outputs_metadata_check check (jsonb_typeof(metadata) = 'object'),
  add constraint v2_generated_outputs_expiry_check check (expires_at > created_at),
  add constraint v2_generated_outputs_r2_object_key unique (r2_bucket, r2_key);

alter table public.v2_provider_keys
  add constraint v2_provider_keys_provider_check
  check (
    provider in (
      'anthropic',
      'openai',
      'google',
      'openrouter',
      'deepseek',
      'exa',
      'firecrawl',
      'llamaparse'
    )
  );

create or replace function public.append_v2_audit_event(
  p_action text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  audit_id uuid;
begin
  actor_id := nullif(current_setting('app.user_id', true), '')::uuid;
  if actor_id is null then
    raise exception 'app.user_id must be set before appending an audit event';
  end if;
  if p_action is null or p_action !~ '^[a-z0-9_.:-]{3,100}$' then
    raise exception 'invalid audit action';
  end if;
  if p_resource_type is not null and length(p_resource_type) > 100 then
    raise exception 'audit resource type is too long';
  end if;
  if p_resource_id is not null and length(p_resource_id) > 256 then
    raise exception 'audit resource id is too long';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'audit metadata must be a JSON object';
  end if;

  insert into public.v2_audit_log (user_id, action, resource_type, resource_id, metadata)
  values (actor_id, p_action, p_resource_type, p_resource_id, p_metadata)
  returning id into audit_id;
  return audit_id;
end
$$;

revoke all on function public.append_v2_audit_event(text, text, text, jsonb) from public;
grant execute on function public.append_v2_audit_event(text, text, text, jsonb) to app_worker;

create or replace function public.scrub_current_user_audit() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  scrubbed_count bigint;
begin
  actor_id := nullif(current_setting('app.user_id', true), '')::uuid;
  if actor_id is null then
    raise exception 'app.user_id must be set before scrubbing audit records';
  end if;

  update public.v2_audit_log
     set user_id = null,
         resource_id = null,
         metadata = jsonb_build_object('subject_erased', true),
         ip_address = null,
         user_agent = null
   where user_id = actor_id;
  get diagnostics scrubbed_count = row_count;
  return scrubbed_count;
end
$$;

revoke all on function public.scrub_current_user_audit() from public;
grant execute on function public.scrub_current_user_audit() to app_worker;

create or replace function public.v2_audit_provider_key_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.v2_audit_log (user_id, action, resource_type, resource_id, metadata)
  values (
    coalesce(NEW.user_id, OLD.user_id),
    case TG_OP
      when 'INSERT' then 'provider_key.create'
      when 'UPDATE' then 'provider_key.update'
      when 'DELETE' then 'provider_key.delete'
    end,
    'provider_key',
    coalesce(NEW.provider, OLD.provider),
    jsonb_build_object('fingerprint', coalesce(NEW.fingerprint, OLD.fingerprint))
  );
  return coalesce(NEW, OLD);
end
$$;

create or replace function public.v2_audit_entitlement_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' and
     (NEW.tier, NEW.subscription_status, NEW.cancel_at_period_end)
       is not distinct from
     (OLD.tier, OLD.subscription_status, OLD.cancel_at_period_end) then
    return NEW;
  end if;
  insert into public.v2_audit_log (user_id, action, resource_type, resource_id, metadata)
  values (
    coalesce(NEW.user_id, OLD.user_id),
    'billing.entitlement.' || lower(TG_OP),
    'entitlement',
    null,
    jsonb_strip_nulls(jsonb_build_object(
      'tier', case when TG_OP = 'DELETE' then OLD.tier else NEW.tier end,
      'subscription_status',
        case when TG_OP = 'DELETE' then OLD.subscription_status else NEW.subscription_status end,
      'cancel_at_period_end',
        case when TG_OP = 'DELETE' then OLD.cancel_at_period_end else NEW.cancel_at_period_end end
    ))
  );
  return coalesce(NEW, OLD);
end
$$;

create trigger v2_audit_entitlement_change_trigger
after insert or update or delete on public.v2_entitlements
for each row execute function public.v2_audit_entitlement_change();

create or replace function public.v2_audit_integration_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.v2_audit_log (user_id, action, resource_type, resource_id, metadata)
  values (
    coalesce(NEW.user_id, OLD.user_id),
    'integration.' || lower(TG_OP),
    'integration',
    coalesce(NEW.integration, OLD.integration),
    jsonb_build_object('status', coalesce(NEW.status, OLD.status))
  );
  return coalesce(NEW, OLD);
end
$$;

create trigger v2_audit_integration_change_trigger
after insert or update or delete on public.v2_user_integrations
for each row execute function public.v2_audit_integration_change();

create table if not exists public._audit_archive_manifest (
  partition_name text primary key check (partition_name ~ '^v2_audit_log_[0-9]{4}_(0[1-9]|1[0-2])$'),
  month_start date not null unique,
  bucket text not null check (bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'),
  format_version integer not null default 1 check (format_version = 1),
  object_key text unique,
  row_count bigint check (row_count >= 0),
  size_bytes bigint check (size_bytes >= 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('detached', 'verified', 'dropped')),
  detached_at timestamptz not null,
  verified_at timestamptz,
  dropped_at timestamptz,
  check (
    object_key is null
    or object_key ~ ('^[0-9]{4}-(0[1-9]|1[0-2])/audit_log-' || sha256 || '\.ndjson\.gz$')
  ),
  check (
    (
      state = 'detached'
      and object_key is null
      and row_count is null
      and size_bytes is null
      and sha256 is null
      and verified_at is null
      and dropped_at is null
    )
    or (
      state = 'verified'
      and object_key is not null
      and row_count is not null
      and size_bytes is not null
      and sha256 is not null
      and verified_at is not null
      and dropped_at is null
    )
    or (
      state = 'dropped'
      and object_key is not null
      and row_count is not null
      and size_bytes is not null
      and sha256 is not null
      and verified_at is not null
      and dropped_at is not null
    )
  )
);

revoke all on public._audit_archive_manifest from public, app_worker;
