--
-- PostgreSQL database dump
--

-- NOTE: The 0000 checksum was intentionally revised on 2026-07-31; its ledger
-- hash was updated in the same production operation.

-- Cheatcode runs only on Supabase Postgres. Bootstrap the external objects that
-- are intentionally outside the public schema dump before restoring it.
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_gateway') THEN
    CREATE ROLE app_gateway
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_agent') THEN
    CREATE ROLE app_agent
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_webhooks') THEN
    CREATE ROLE app_webhooks
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$roles$;

ALTER ROLE app_gateway SET search_path = public, pg_catalog;
ALTER ROLE app_agent SET search_path = public, pg_catalog;
ALTER ROLE app_webhooks SET search_path = public, pg_catalog;

DO $database_access$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO app_gateway, app_agent, app_webhooks',
    pg_catalog.current_database()
  );
END
$database_access$;


-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: claim_provider_key_revalidation_targets(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_provider_key_revalidation_targets(p_limit integer) RETURNS TABLE(user_id uuid, provider text, fingerprint text, lease_token uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with targets as (
    select key.user_id, key.provider
      from public.v2_provider_keys key
     where key.disabled_at is null
       and (
         key.last_revalidated_at is null
         or key.last_revalidated_at < pg_catalog.now() - interval '23 hours'
       )
       and (
         key.revalidation_claimed_at is null
         or key.revalidation_claimed_at < pg_catalog.now() - interval '15 minutes'
       )
     order by
       key.last_revalidated_at asc nulls first,
       key.revalidation_claimed_at asc nulls first,
       key.created_at,
       key.user_id,
       key.provider
     for update skip locked
     limit least(greatest(coalesce(p_limit, 10), 1), 10)
  ), claimed as (
    update public.v2_provider_keys key
       set revalidation_claimed_at = pg_catalog.now(),
           revalidation_lease_token = public.uuidv7()
      from targets
     where key.user_id = targets.user_id
       and key.provider = targets.provider
    returning key.user_id, key.provider, key.fingerprint, key.revalidation_lease_token
  )
  select claimed.user_id, claimed.provider, claimed.fingerprint, claimed.revalidation_lease_token
    from claimed
$$;


--
-- Name: current_app_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_user() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  actor_id uuid;
  actor_text text := pg_catalog.current_setting('app.user_id', true);
  audience text := session_user;
  context_secret text;
  expected_description text;
  expected_hmac bytea;
  expected_name text;
  issued_at bigint;
  issued_text text := pg_catalog.current_setting('app.context_issued_at', true);
  nonce_text text := pg_catalog.current_setting('app.context_nonce', true);
  now_ms bigint;
  payload text;
  signature_difference integer;
  signature_text text := pg_catalog.current_setting('app.context_signature', true);
  supplied_hmac bytea;
begin
  if audience not in ('app_agent', 'app_gateway', 'app_webhooks') then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context is unavailable to this database role';
  end if;
  if actor_text is null
     or actor_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or issued_text is null
     or issued_text !~ '^[0-9]{13}$'
     or nonce_text is null
     or nonce_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or signature_text is null
     or signature_text !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context is malformed';
  end if;

  actor_id := actor_text::uuid;
  issued_at := issued_text::bigint;
  now_ms := (
    extract(epoch from pg_catalog.transaction_timestamp()) * 1000
  )::bigint;
  if issued_at < now_ms - 15000 or issued_at > now_ms + 2000 then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context is outside its freshness window';
  end if;

  expected_name := 'cheatcode-database-context-' ||
    pg_catalog.replace(audience, '_', '-') || '-v1';
  expected_description := 'Cheatcode signed tenant context HMAC for ' || audience;
  select secret.decrypted_secret into strict context_secret
    from vault.decrypted_secrets secret
   where secret.name = expected_name
     and secret.description = expected_description;
  if pg_catalog.octet_length(context_secret) < 32 then
    raise exception 'signed tenant context secret is invalid';
  end if;

  payload := 'cheatcode-database-context-v1' || pg_catalog.chr(10) ||
    audience || pg_catalog.chr(10) || actor_text || pg_catalog.chr(10) ||
    issued_text || pg_catalog.chr(10) || nonce_text;
  expected_hmac := extensions.hmac(
    pg_catalog.convert_to(payload, 'UTF8'),
    pg_catalog.convert_to(context_secret, 'UTF8'),
    'sha256'
  );
  supplied_hmac := pg_catalog.decode(signature_text, 'hex');
  select pg_catalog.bit_or(
    pg_catalog.get_byte(expected_hmac, offset_value) #
    pg_catalog.get_byte(supplied_hmac, offset_value)
  ) into signature_difference
    from pg_catalog.generate_series(0, 31) as offsets(offset_value);
  if signature_difference is distinct from 0 then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context signature is invalid';
  end if;
  return actor_id;
exception
  when no_data_found or too_many_rows then
    raise exception using
      errcode = '42501',
      message = 'signed tenant context secret contract is invalid';
end
$_$;


--
-- Name: delete_all_provider_keys(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_all_provider_keys() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_id uuid := public.current_app_user();
  deleted_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cheatcode:provider-keys:' || actor_id::text,
      0
    )
  );
  delete from public.v2_provider_keys where user_id = actor_id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;


--
-- Name: delete_provider_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_provider_key(p_provider text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_id uuid := public.current_app_user();
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cheatcode:provider-keys:' || actor_id::text,
      0
    )
  );
  delete from public.v2_provider_keys
   where user_id = actor_id and provider = p_provider;
end
$$;


--
-- Name: gateway_resolve_clerk_user(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gateway_resolve_clerk_user(p_clerk_id text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select app_user.id
    from public.v2_users app_user
   where app_user.clerk_id = p_clerk_id and app_user.deleted_at is null
   limit 1
$$;


--
-- Name: get_provider_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_provider_key(p_provider text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select secret.decrypted_secret
    from public.v2_provider_keys key
    join vault.decrypted_secrets secret on secret.id = key.vault_secret_id
   where key.user_id = public.current_app_user()
     and key.provider = p_provider
     and key.disabled_at is null
$$;


--
-- Name: scrub_current_user_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scrub_current_user_audit() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_id uuid := public.current_app_user();
  scrubbed_count bigint;
begin
  update public.v2_audit_log
     set user_id = null,
         resource_id = null,
         metadata = jsonb_build_object('subject_erased', true)
   where user_id = actor_id;
  get diagnostics scrubbed_count = row_count;
  return scrubbed_count;
end
$$;


--
-- Name: set_provider_key(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_provider_key(p_provider text, p_key text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  actor_id uuid := public.current_app_user();
  secret_id uuid;
  key_fingerprint text;
begin
  if p_provider is null or p_provider not in (
    'anthropic',
    'openai',
    'google',
    'openrouter',
    'deepseek',
    'exa',
    'firecrawl'
  ) then
    raise exception 'unsupported provider';
  end if;
  if p_key is null or btrim(p_key) = '' or octet_length(p_key) > 65536 then
    raise exception 'provider key must contain between 1 and 65536 bytes';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cheatcode:provider-keys:' || actor_id::text,
      0
    )
  );

  key_fingerprint := substring(
    encode(extensions.digest(convert_to(p_key, 'UTF8'), 'sha256'), 'hex')
    for 12
  );

  delete from public.v2_provider_keys
   where user_id = actor_id and provider = p_provider;

  secret_id := vault.create_secret(
    p_key,
    actor_id::text || ':' || p_provider || ':' || public.uuidv7()::text,
    'Cheatcode V2 BYOK provider key'
  );

  insert into public.v2_provider_keys (
    user_id,
    provider,
    vault_secret_id,
    fingerprint
  ) values (
    actor_id,
    p_provider,
    secret_id,
    key_fingerprint
  );
end
$$;


--
-- Name: sync_clerk_user(text, text, text, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_clerk_user(p_clerk_id text, p_email text, p_display_name text, p_avatar_url text, p_clerk_updated_at_ms bigint) RETURNS TABLE(sync_state text, user_id uuid, email text, display_name text, avatar_url text, polar_customer_id text, clerk_updated_at_ms bigint, email_changed boolean, profile_changed boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  has_existing boolean;
  identity_hash text;
  existing record;
  persisted record;
begin
  if p_clerk_id is null or btrim(p_clerk_id) = '' or octet_length(p_clerk_id) > 512 then
    raise exception 'invalid Clerk identity';
  end if;
  if p_email is null or btrim(p_email) = '' or octet_length(p_email) > 512 then
    raise exception 'invalid Clerk email';
  end if;
  if p_clerk_updated_at_ms is null
     or p_clerk_updated_at_ms < 0
     or p_clerk_updated_at_ms > 9007199254740991 then
    raise exception 'invalid Clerk source version';
  end if;
  if octet_length(coalesce(p_display_name, '')) > 1024
     or octet_length(coalesce(p_avatar_url, '')) > 4096 then
    raise exception 'invalid Clerk profile payload';
  end if;

  identity_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_clerk_id, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:clerk-identity:' || identity_hash, 0)
  );
  if exists (
    select 1 from public.v2_deleted_clerk_identities retired
     where retired.clerk_identity_hash = identity_hash
  ) then
    return query select 'completed', null::uuid, null::text, null::text,
      null::text, null::text, null::bigint, false, false;
    return;
  end if;

  select app_user.id, app_user.avatar_url, app_user.clerk_updated_at_ms,
         app_user.deleted_at, app_user.display_name, app_user.email,
         app_user.polar_customer_id
    into existing
    from public.v2_users app_user
   where app_user.clerk_id = p_clerk_id;
  has_existing := found;
  if has_existing and existing.deleted_at is not null then
    return query select 'in_progress', null::uuid, null::text, null::text,
      null::text, null::text, null::bigint, false, false;
    return;
  end if;
  if has_existing and existing.clerk_updated_at_ms > p_clerk_updated_at_ms then
    return query select 'stale', existing.id, existing.email, existing.display_name,
      existing.avatar_url, existing.polar_customer_id, existing.clerk_updated_at_ms,
      false, false;
    return;
  end if;
  if has_existing and existing.clerk_updated_at_ms = p_clerk_updated_at_ms then
    return query select 'unchanged', existing.id, existing.email, existing.display_name,
      existing.avatar_url, existing.polar_customer_id, existing.clerk_updated_at_ms,
      false, false;
    return;
  end if;

  if has_existing then
    update public.v2_users app_user
       set email = btrim(p_email),
           display_name = nullif(btrim(p_display_name), ''),
           avatar_url = nullif(btrim(p_avatar_url), ''),
           clerk_updated_at_ms = p_clerk_updated_at_ms
     where app_user.id = existing.id
       and app_user.deleted_at is null
       and app_user.deletion_fence is null
       and app_user.clerk_updated_at_ms < p_clerk_updated_at_ms
    returning app_user.id, app_user.email, app_user.display_name,
              app_user.avatar_url, app_user.polar_customer_id,
              app_user.clerk_updated_at_ms
         into persisted;
  else
    insert into public.v2_users (
      clerk_id, clerk_updated_at_ms, email, display_name, avatar_url
    ) values (
      p_clerk_id,
      p_clerk_updated_at_ms,
      btrim(p_email),
      nullif(btrim(p_display_name), ''),
      nullif(btrim(p_avatar_url), '')
    )
    returning id, public.v2_users.email, public.v2_users.display_name,
              public.v2_users.avatar_url, public.v2_users.polar_customer_id,
              public.v2_users.clerk_updated_at_ms
         into persisted;
  end if;
  if not found then
    return query select 'in_progress', null::uuid, null::text, null::text,
      null::text, null::text, null::bigint, false, false;
    return;
  end if;

  insert into public.v2_entitlements (user_id, tier)
  values (persisted.id, 'free')
  on conflict on constraint v2_entitlements_pkey do nothing;
  return query select
    case when has_existing then 'updated' else 'created' end,
    persisted.id,
    persisted.email,
    persisted.display_name,
    persisted.avatar_url,
    persisted.polar_customer_id,
    persisted.clerk_updated_at_ms,
    has_existing and existing.email is distinct from persisted.email,
    has_existing and (
      existing.email is distinct from persisted.email
      or existing.display_name is distinct from persisted.display_name
      or existing.avatar_url is distinct from persisted.avatar_url
    );
end
$$;


--
-- Name: uuidv7(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uuidv7() RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with
    timestamp_bytes as (
      select substring(
        int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint)
        from 3
        for 6
      ) as value
    ),
    random_bytes as (
      select extensions.gen_random_bytes(10) as value
    ),
    uuid_bytes as (
      select
        timestamp_bytes.value
        || set_byte(
          substring(random_bytes.value from 1 for 2),
          0,
          (get_byte(random_bytes.value, 0) & 15) | 112
        )
        || set_byte(
          substring(random_bytes.value from 3 for 8),
          0,
          (get_byte(random_bytes.value, 2) & 63) | 128
        ) as value
      from timestamp_bytes, random_bytes
    )
  select encode(uuid_bytes.value, 'hex')::uuid
  from uuid_bytes;
$$;


--
-- Name: v2_audit_entitlement_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.v2_audit_entitlement_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: v2_audit_integration_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.v2_audit_integration_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if tg_op = 'UPDATE'
     and (new.status, new.is_default) is not distinct from (old.status, old.is_default) then
    return new;
  end if;

  insert into public.v2_audit_log (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    coalesce(new.user_id, old.user_id),
    'integration.' || lower(tg_op),
    'integration',
    coalesce(new.integration, old.integration),
    jsonb_build_object('status', coalesce(new.status, old.status))
  );
  return coalesce(new, old);
end
$$;


--
-- Name: v2_audit_provider_key_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.v2_audit_provider_key_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  audit_action text;
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array[
       'last_revalidated_at',
       'revalidation_claimed_at',
       'revalidation_lease_token'
     ]) is not distinct from (to_jsonb(old) - array[
       'last_revalidated_at',
       'revalidation_claimed_at',
       'revalidation_lease_token'
     ]) then
    return new;
  end if;

  audit_action := case
    when tg_op = 'INSERT' then 'provider_key.create'
    when tg_op = 'DELETE' then 'provider_key.delete'
    when old.disabled_at is null and new.disabled_at is not null then 'provider_key.disable'
    when old.disabled_at is not null and new.disabled_at is null then 'provider_key.enable'
    else 'provider_key.update'
  end;

  insert into public.v2_audit_log (
    user_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    coalesce(new.user_id, old.user_id),
    audit_action,
    'provider_key',
    coalesce(new.provider, old.provider),
    jsonb_build_object('fingerprint', coalesce(new.fingerprint, old.fingerprint))
  );
  return coalesce(new, old);
end
$$;


--
-- Name: v2_delete_provider_vault_secret(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.v2_delete_provider_vault_secret() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  secret_name text;
  secret_description text;
begin
  delete from vault.secrets
   where id = old.vault_secret_id
  returning name, description into secret_name, secret_description;

  if not found then
    raise exception 'refusing to delete a provider key with a missing Vault secret';
  end if;
  if secret_name not like old.user_id::text || ':' || old.provider || ':%'
     or secret_description is distinct from 'Cheatcode V2 BYOK provider key' then
    raise exception 'refusing to delete a provider key with mismatched Vault ownership metadata';
  end if;
  return old;
end
$$;


--
-- Name: v2_guard_terminal_agent_run_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.v2_guard_terminal_agent_run_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.status in ('completed', 'failed', 'canceled')
     and (
       new.status is distinct from old.status
       or new.finished_at is distinct from old.finished_at
     ) then
    raise exception 'terminal agent-run state is immutable'
      using errcode = '23514';
  end if;
  return new;
end
$$;


--
-- Name: v2_guard_user_deletion_refund_resolution(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.v2_guard_user_deletion_refund_resolution() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if (
    tg_op = 'DELETE'
    or (old.phase = 'billing' and new.phase <> 'billing')
  ) and exists (
    select 1
      from public.v2_user_deletion_refund_intents refund_intent
     where refund_intent.job_id = old.id
       and refund_intent.provider_status is distinct from 'succeeded'
  ) then
    raise exception 'user-deletion job has an unresolved refund intent';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;


--
-- Name: v2_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.v2_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;


--
-- Name: webhooks_claim_ready_resource_deletion_jobs(uuid, integer, integer, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_claim_ready_resource_deletion_jobs(p_lease_token uuid, p_limit integer, p_max_failures integer, p_now timestamp with time zone) RETURNS TABLE(disposition text, job_id uuid, user_id uuid, continuation integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  candidate_ids uuid[];
  quarantine_ids uuid[];
begin
  if p_lease_token is null or p_now is null or p_max_failures < 1 then
    raise exception 'invalid resource-deletion claim input';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:database-maintenance:v1', 0)
  ) then
    return;
  end if;
  select coalesce(array_agg(candidate.id), array[]::uuid[])
    into candidate_ids
    from (
      select job.id
        from public.v2_resource_deletion_jobs job
       where (job.status = 'queued' and job.next_attempt_at <= p_now)
          or (job.status = 'leased' and job.lease_expires_at <= p_now)
       order by job.next_attempt_at, job.id
       limit greatest(1, least(coalesce(p_limit, 1), 25))
       for update skip locked
    ) candidate;
  select coalesce(array_agg(job.id), array[]::uuid[])
    into quarantine_ids
    from public.v2_resource_deletion_jobs job
   where job.id = any(candidate_ids)
     and job.status = 'leased'
     and job.failure_count + 1 >= p_max_failures;

  return query
  update public.v2_resource_deletion_jobs job
     set continuation = job.continuation + 1,
         failure_count = job.failure_count + 1,
         last_error_code = 'resource_deletion_lease_expired',
         lease_expires_at = null,
         lease_token = null,
         status = 'quarantined'
   where job.id = any(quarantine_ids)
  returning 'quarantined'::text, job.id, job.user_id, job.continuation;
  return query
  update public.v2_resource_deletion_jobs job
     set continuation = case when job.status = 'leased'
           then job.continuation + 1 else job.continuation end,
         failure_count = case when job.status = 'leased'
           then job.failure_count + 1 else job.failure_count end,
         last_error_code = case when job.status = 'leased'
           then 'resource_deletion_lease_expired' else job.last_error_code end,
         lease_expires_at = p_now + interval '2 hours',
         lease_token = p_lease_token,
         next_attempt_at = case when job.status = 'leased'
           then p_now else job.next_attempt_at end,
         status = 'leased'
   where job.id = any(candidate_ids)
     and not (job.id = any(quarantine_ids))
  returning 'leased'::text, job.id, job.user_id, job.continuation;
end
$$;


--
-- Name: webhooks_claim_ready_user_deletion_jobs(uuid, integer, integer, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_claim_ready_user_deletion_jobs(p_lease_token uuid, p_limit integer, p_max_failures integer, p_now timestamp with time zone) RETURNS TABLE(disposition text, job_id uuid, user_id uuid, continuation integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  candidate record;
  expected_fence text;
  page_size integer := greatest(1, least(coalesce(p_limit, 1), 25));
begin
  if p_lease_token is null or p_now is null or p_max_failures is null
    or p_max_failures < 1 then
    raise exception 'invalid user-deletion claim input';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:database-maintenance:v1', 0)
  ) then
    return;
  end if;
  for candidate in
    select job.id, job.user_id, job.generation, job.continuation,
           job.failure_count, job.status
      from public.v2_user_deletion_jobs job
     where (job.status = 'queued' and job.next_attempt_at <= p_now)
        or (job.status = 'leased' and job.lease_expires_at <= p_now)
     order by job.next_attempt_at, job.id
     limit page_size
     for update skip locked
  loop
    expected_fence := (
      pg_catalog.trunc(extract(epoch from candidate.generation) * 1000)::bigint
    )::text;
    update public.v2_users app_user
       set deletion_fence = expected_fence
     where app_user.id = candidate.user_id
       and app_user.deleted_at = candidate.generation
       and (
         app_user.deletion_fence is null
         or app_user.deletion_fence = expected_fence
       );
    if not found then
      delete from public.v2_user_deletion_jobs job where job.id = candidate.id;
      return query select 'stale'::text, candidate.id, candidate.user_id,
        candidate.continuation;
    elsif candidate.status = 'leased'
      and candidate.failure_count + 1 >= p_max_failures then
      return query
      update public.v2_user_deletion_jobs job
         set continuation = job.continuation + 1,
             failure_count = job.failure_count + 1,
             last_error_code = 'user_deletion_lease_expired',
             lease_expires_at = null,
             lease_token = null,
             status = 'quarantined'
       where job.id = candidate.id
      returning 'quarantined'::text, job.id, job.user_id, job.continuation;
    else
      return query
      update public.v2_user_deletion_jobs job
         set continuation = case when candidate.status = 'leased'
               then job.continuation + 1 else job.continuation end,
             failure_count = case when candidate.status = 'leased'
               then job.failure_count + 1 else job.failure_count end,
             last_error_code = case when candidate.status = 'leased'
               then 'user_deletion_lease_expired' else job.last_error_code end,
             lease_expires_at = p_now + interval '2 hours',
             lease_token = p_lease_token,
             next_attempt_at = case when candidate.status = 'leased'
               then p_now else job.next_attempt_at end,
             status = 'leased'
       where job.id = candidate.id
      returning 'leased'::text, job.id, job.user_id, job.continuation;
    end if;
  end loop;
end
$$;


--
-- Name: webhooks_discover_resource_deletion_jobs(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_discover_resource_deletion_jobs(p_limit integer) RETURNS TABLE(projects integer, threads integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  project_count integer;
  page_size integer := greatest(1, least(coalesce(p_limit, 1), 25));
  thread_count integer;
begin
  with candidates as (
    select project.user_id, project.id, project.deleted_at
      from public.v2_projects project
      join public.v2_users app_user on app_user.id = project.user_id
     where project.deleted_at is not null and app_user.deleted_at is null
     order by project.deleted_at, project.id
     limit page_size
  ), inserted as (
    insert into public.v2_resource_deletion_jobs (user_id, kind, resource_id, generation)
    select candidate.user_id, 'project-deletion', candidate.id, candidate.deleted_at
      from candidates candidate
    on conflict (kind, resource_id, generation) do nothing
    returning id
  ) select count(*)::integer into project_count from inserted;

  with candidates as (
    select thread.user_id, thread.id, thread.deleted_at
      from public.v2_threads thread
      join public.v2_users app_user on app_user.id = thread.user_id
      left join public.v2_projects project
        on project.id = thread.project_id and project.user_id = thread.user_id
     where thread.deleted_at is not null
       and app_user.deleted_at is null
       and (thread.project_id is null or project.deleted_at is null)
     order by thread.deleted_at, thread.id
     limit page_size
  ), inserted as (
    insert into public.v2_resource_deletion_jobs (user_id, kind, resource_id, generation)
    select candidate.user_id, 'thread-deletion', candidate.id, candidate.deleted_at
      from candidates candidate
    on conflict (kind, resource_id, generation) do nothing
    returning id
  ) select count(*)::integer into thread_count from inserted;
  return query select project_count, thread_count;
end
$$;


--
-- Name: webhooks_discover_user_deletion_jobs(timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_discover_user_deletion_jobs(p_before timestamp with time zone, p_limit integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  discovered integer;
  page_size integer := greatest(1, least(coalesce(p_limit, 1), 25));
begin
  if p_before is null then
    raise exception 'invalid user-deletion discovery cutoff';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:database-maintenance:v1', 0)
  ) then
    return 0;
  end if;
  with candidates as (
    select app_user.id, app_user.deleted_at
      from public.v2_users app_user
     where app_user.deleted_at <= p_before
       and (
         app_user.deletion_fence is null
         or app_user.deletion_fence = (
           pg_catalog.trunc(extract(epoch from app_user.deleted_at) * 1000)::bigint
         )::text
       )
       and not exists (
         select 1
           from public.v2_user_deletion_jobs existing
          where existing.user_id = app_user.id
            and existing.generation = app_user.deleted_at
       )
     order by app_user.deleted_at, app_user.id
     limit page_size
  ), inserted as (
    insert into public.v2_user_deletion_jobs (user_id, generation)
    select candidate.id, candidate.deleted_at
      from candidates candidate
    on conflict (user_id, generation) do nothing
    returning id
  )
  select count(*)::integer into discovered from inserted;
  return discovered;
end
$$;


--
-- Name: webhooks_expire_composio_connection(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_expire_composio_connection(p_connection_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  target record;
begin
  select connection.user_id, connection.integration
    into target
    from public.v2_user_integrations connection
   where connection.composio_connection_id = p_connection_id
   for update;
  if not found then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.user_id::text || ':' || target.integration, 0)
  );
  update public.v2_user_integrations connection
     set status = 'expired', is_default = false
   where connection.composio_connection_id = p_connection_id
     and (connection.status is distinct from 'expired' or connection.is_default);
  update public.v2_user_integrations connection
     set is_default = false
   where connection.user_id = target.user_id
     and connection.integration = target.integration
     and connection.is_default
     and lower(connection.status) not in ('active', 'authorized', 'connected', 'enabled');
  update public.v2_user_integrations connection
     set is_default = true
   where connection.composio_connection_id = (
     select candidate.composio_connection_id
       from public.v2_user_integrations candidate
      where candidate.user_id = target.user_id
        and candidate.integration = target.integration
        and lower(candidate.status) in ('active', 'authorized', 'connected', 'enabled')
      order by candidate.updated_at desc, candidate.composio_connection_id
      limit 1
   ) and not exists (
     select 1 from public.v2_user_integrations existing
      where existing.user_id = target.user_id
        and existing.integration = target.integration
        and existing.is_default
   );
  return true;
end
$$;


--
-- Name: webhooks_finalize_current_user_deletion(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_finalize_current_user_deletion(p_deletion_fence text, p_clerk_identity_hash text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  actor_id uuid := public.current_app_user();
  deleted_id uuid;
begin
  if p_deletion_fence is null or p_deletion_fence = ''
     or p_clerk_identity_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid user-deletion finalization identity';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:clerk-identity:' || p_clerk_identity_hash, 0)
  );
  if exists (
    select 1 from public.v2_deleted_clerk_identities retired
     where retired.clerk_identity_hash = p_clerk_identity_hash
  ) then
    return false;
  end if;
  if not exists (
    select 1 from public.v2_users app_user
     where app_user.id = actor_id and app_user.deletion_fence = p_deletion_fence
  ) then
    raise exception 'user deletion fence is no longer valid';
  end if;
  insert into public.v2_deleted_clerk_identities (clerk_identity_hash)
  values (p_clerk_identity_hash);
  delete from public.v2_users app_user
   where app_user.id = actor_id and app_user.deletion_fence = p_deletion_fence
  returning app_user.id into deleted_id;
  if deleted_id is null then
    raise exception 'claimed user deletion did not remove exactly one user';
  end if;
  return true;
end
$_$;


--
-- Name: webhooks_list_daily_activation_events(date, text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_list_daily_activation_events(p_day date, p_cursor_event text, p_cursor_user_id uuid, p_limit integer) RETURNS TABLE(event_order integer, event_name text, user_id uuid, cohort_week text, cohort_month text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with bounded as (
    select greatest(1, least(coalesce(p_limit, 1), 200)) as page_size,
           case
             when p_cursor_event is null then null
             when p_cursor_event = 'retention_d7' then 1
             when p_cursor_event = 'retention_d28' then 2
             when p_cursor_event = 'first_week_mau' then 3
             else -1
           end as cursor_order
  ), activation_events as (
    select 1 as event_order, 'retention_d7'::text as event_name,
           candidate.id as user_id,
           to_char(date_trunc('week', candidate.created_at), 'YYYY-MM-DD') as cohort_week,
           to_char(date_trunc('month', candidate.created_at), 'YYYY-MM-DD') as cohort_month
      from public.v2_users candidate
     where candidate.deleted_at is null
       and candidate.created_at >= p_day - interval '7 days'
       and candidate.created_at < p_day - interval '6 days'
       and exists (
         select 1 from public.v2_agent_runs run
          where run.user_id = candidate.id
            and run.started_at >= p_day
            and run.started_at < p_day + interval '1 day'
       )
    union all
    select 2, 'retention_d28'::text, candidate.id,
           to_char(date_trunc('week', candidate.created_at), 'YYYY-MM-DD'),
           to_char(date_trunc('month', candidate.created_at), 'YYYY-MM-DD')
      from public.v2_users candidate
     where candidate.deleted_at is null
       and candidate.created_at >= p_day - interval '28 days'
       and candidate.created_at < p_day - interval '27 days'
       and exists (
         select 1 from public.v2_agent_runs run
          where run.user_id = candidate.id
            and run.started_at >= p_day
            and run.started_at < p_day + interval '1 day'
       )
    union all
    select 3, 'first_week_mau'::text, candidate.id,
           to_char(date_trunc('week', candidate.created_at), 'YYYY-MM-DD'), null::text
      from public.v2_users candidate
     where candidate.deleted_at is null
       and candidate.created_at >= p_day - interval '7 days'
       and candidate.created_at < p_day - interval '6 days'
       and (
         select count(*) from public.v2_agent_runs run
          where run.user_id = candidate.id
            and run.started_at >= candidate.created_at
            and run.started_at < candidate.created_at + interval '7 days'
       ) >= 3
  )
  select event.event_order, event.event_name, event.user_id,
         event.cohort_week, event.cohort_month
    from activation_events event, bounded
   where (bounded.cursor_order is null and p_cursor_user_id is null)
      or (
        bounded.cursor_order > 0
        and p_cursor_user_id is not null
        and (event.event_order, event.user_id) > (bounded.cursor_order, p_cursor_user_id)
      )
   order by event.event_order, event.user_id
   limit (select page_size + 1 from bounded)
$$;


--
-- Name: webhooks_mark_clerk_user_deleted(text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_mark_clerk_user_deleted(p_clerk_id text, p_deleted_at timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  identity_hash text;
  deleted_user_id uuid;
begin
  if p_clerk_id is null or btrim(p_clerk_id) = '' or p_deleted_at is null then
    raise exception 'invalid Clerk deletion payload';
  end if;
  identity_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_clerk_id, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cheatcode:clerk-identity:' || identity_hash, 0)
  );
  update public.v2_users app_user
     set deleted_at = coalesce(app_user.deleted_at, p_deleted_at),
         deletion_fence = null
   where app_user.clerk_id = p_clerk_id and app_user.deletion_fence is null
  returning app_user.id into deleted_user_id;
  return deleted_user_id;
end
$$;


--
-- Name: webhooks_record_user_deletion_refund_evidence(uuid, timestamp with time zone, integer, uuid, text, text, integer, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_record_user_deletion_refund_evidence(p_job_id uuid, p_generation timestamp with time zone, p_continuation integer, p_lease_token uuid, p_cursor text, p_order_id text, p_amount integer, p_currency text, p_idempotency_key text, p_provider_refund_id text, p_provider_status text) RETURNS TABLE(job_id uuid, user_id uuid, generation timestamp with time zone, order_id text, amount integer, currency text, idempotency_key text, provider_refund_id text, provider_status text, created_at timestamp with time zone, reconciled_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  actor_id uuid := public.current_app_user();
  current_intent public.v2_user_deletion_refund_intents%rowtype;
begin
  if actor_id is null or p_job_id is null or p_generation is null
     or p_continuation is null or p_continuation < 0
     or p_lease_token is null or p_order_id is null or btrim(p_order_id) = ''
     or p_amount is null or p_amount < 1
     or p_currency is null or p_currency !~ '^[a-z]{3}$'
     or p_idempotency_key is null or p_idempotency_key = ''
     or p_provider_refund_id is null or btrim(p_provider_refund_id) = ''
     or p_provider_status is null
     or p_provider_status not in ('pending', 'succeeded', 'failed', 'canceled') then
    raise exception 'invalid user-deletion refund evidence';
  end if;

  perform 1
    from public.v2_user_deletion_jobs deletion_job
   where deletion_job.id = p_job_id
     and deletion_job.user_id = actor_id
     and deletion_job.generation = p_generation
     and deletion_job.continuation = p_continuation
     and deletion_job.status = 'leased'
     and deletion_job.lease_token = p_lease_token
     and deletion_job.phase = 'billing'
     and deletion_job.cursor is not distinct from p_cursor
   for update;
  if not found then
    return;
  end if;

  select intent.* into current_intent
    from public.v2_user_deletion_refund_intents intent
   where intent.job_id = p_job_id
     and intent.user_id = actor_id
     and intent.generation = p_generation
   for update;
  if not found then
    raise exception 'user-deletion refund intent is missing';
  end if;

  if current_intent.order_id <> p_order_id
     or current_intent.amount <> p_amount
     or current_intent.currency <> p_currency
     or current_intent.idempotency_key <> p_idempotency_key then
    raise exception 'user-deletion refund immutable identity changed';
  end if;
  if current_intent.provider_refund_id is not null
     and current_intent.provider_refund_id <> p_provider_refund_id then
    raise exception 'user-deletion provider refund identity changed';
  end if;
  if current_intent.provider_status is not null
     and current_intent.provider_status <> 'pending'
     and current_intent.provider_status <> p_provider_status then
    raise exception 'user-deletion provider refund status regressed';
  end if;

  update public.v2_user_deletion_refund_intents intent
     set provider_refund_id = p_provider_refund_id,
         provider_status = p_provider_status,
         reconciled_at = now()
   where intent.job_id = p_job_id;

  return query
  select intent.job_id,
         intent.user_id,
         intent.generation,
         intent.order_id,
         intent.amount,
         intent.currency,
         intent.idempotency_key,
         intent.provider_refund_id,
         intent.provider_status,
         intent.created_at,
         intent.reconciled_at
    from public.v2_user_deletion_refund_intents intent
   where intent.job_id = p_job_id;
end
$_$;


--
-- Name: webhooks_reserve_user_deletion_refund_intent(uuid, timestamp with time zone, integer, uuid, text, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_reserve_user_deletion_refund_intent(p_job_id uuid, p_generation timestamp with time zone, p_continuation integer, p_lease_token uuid, p_cursor text, p_order_id text, p_amount integer, p_currency text) RETURNS TABLE(job_id uuid, user_id uuid, generation timestamp with time zone, order_id text, amount integer, currency text, idempotency_key text, provider_refund_id text, provider_status text, created_at timestamp with time zone, reconciled_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  actor_id uuid := public.current_app_user();
begin
  if actor_id is null or p_job_id is null or p_generation is null
     or p_continuation is null or p_continuation < 0
     or p_lease_token is null or p_order_id is null or btrim(p_order_id) = ''
     or p_amount is null or p_amount < 1
     or p_currency is null or p_currency !~ '^[a-z]{3}$' then
    raise exception 'invalid user-deletion refund reservation';
  end if;

  perform 1
    from public.v2_user_deletion_jobs deletion_job
   where deletion_job.id = p_job_id
     and deletion_job.user_id = actor_id
     and deletion_job.generation = p_generation
     and deletion_job.continuation = p_continuation
     and deletion_job.status = 'leased'
     and deletion_job.lease_token = p_lease_token
     and deletion_job.phase = 'billing'
     and deletion_job.cursor is not distinct from p_cursor
   for update;
  if not found then
    return;
  end if;

  insert into public.v2_user_deletion_refund_intents (
    job_id,
    user_id,
    generation,
    order_id,
    amount,
    currency,
    idempotency_key
  ) values (
    p_job_id,
    actor_id,
    p_generation,
    p_order_id,
    p_amount,
    p_currency,
    'cheatcode:user-deletion-refund:' || p_job_id::text
  )
  on conflict on constraint v2_user_deletion_refund_intents_pkey do nothing;

  return query
  select intent.job_id,
         intent.user_id,
         intent.generation,
         intent.order_id,
         intent.amount,
         intent.currency,
         intent.idempotency_key,
         intent.provider_refund_id,
         intent.provider_status,
         intent.created_at,
         intent.reconciled_at
    from public.v2_user_deletion_refund_intents intent
   where intent.job_id = p_job_id
     and intent.user_id = actor_id
     and intent.generation = p_generation;
end
$_$;


--
-- Name: webhooks_resolve_polar_customer(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.webhooks_resolve_polar_customer(p_polar_customer_id text) RETURNS TABLE(user_id uuid, email text, polar_customer_id text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select app_user.id, app_user.email, app_user.polar_customer_id
    from public.v2_users app_user
   where app_user.polar_customer_id = p_polar_customer_id
     and app_user.deleted_at is null
   limit 1
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;


--
-- Name: v2_agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_agent_runs (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL,
    model_id text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    idempotency_key_hash text,
    request_body_hash text,
    skill_runtime_capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT v2_agent_runs_finished_order_check CHECK (((finished_at IS NULL) OR (finished_at >= started_at))),
    CONSTRAINT v2_agent_runs_idempotency_key_hash_check CHECK (((idempotency_key_hash IS NULL) OR (idempotency_key_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT v2_agent_runs_model_id_canonical_check CHECK (((char_length(model_id) <= 200) AND (model_id ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'::text))),
    CONSTRAINT v2_agent_runs_request_body_hash_check CHECK (((request_body_hash IS NULL) OR (request_body_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT v2_agent_runs_skill_runtime_capabilities_array_check CHECK ((jsonb_typeof(skill_runtime_capabilities) = 'array'::text)),
    CONSTRAINT v2_agent_runs_skill_runtime_capabilities_size_check CHECK ((octet_length((skill_runtime_capabilities)::text) <= 16384)),
    CONSTRAINT v2_agent_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'canceled'::text]))),
    CONSTRAINT v2_agent_runs_terminal_timestamp_check CHECK (((status = ANY (ARRAY['completed'::text, 'failed'::text, 'canceled'::text])) = (finished_at IS NOT NULL)))
);

ALTER TABLE ONLY public.v2_agent_runs FORCE ROW LEVEL SECURITY;


--
-- Name: v2_artifact_upload_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_artifact_upload_intents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    agent_run_id uuid NOT NULL,
    r2_key text NOT NULL,
    cleanup_not_before timestamp(3) with time zone NOT NULL,
    quiesced_at timestamp(3) with time zone,
    CONSTRAINT v2_artifact_upload_intents_r2_identity_check CHECK (((r2_key ~~ ((((((((user_id)::text || '/'::text) || (project_id)::text) || '/'::text) || (agent_run_id)::text) || '/'::text) || (id)::text) || '-%'::text)) AND (strpos(substr(r2_key, (length(((((((((user_id)::text || '/'::text) || (project_id)::text) || '/'::text) || (agent_run_id)::text) || '/'::text) || (id)::text) || '-'::text)) + 1)), '/'::text) = 0) AND (octet_length(r2_key) <= 512)))
);

ALTER TABLE ONLY public.v2_artifact_upload_intents FORCE ROW LEVEL SECURITY;


--
-- Name: v2_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_audit_log (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    resource_type text,
    resource_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.v2_audit_log FORCE ROW LEVEL SECURITY;


--
-- Name: v2_daily_maintenance_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_daily_maintenance_jobs (
    day date NOT NULL,
    scheduled_at timestamp(3) with time zone NOT NULL,
    phase text DEFAULT 'activation'::text NOT NULL,
    activation_cursor_event text,
    activation_cursor_user_id uuid,
    continuation integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    release_version_id uuid,
    lease_token uuid,
    lease_expires_at timestamp(3) with time zone,
    failure_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    last_error_code text,
    completed_at timestamp(3) with time zone,
    CONSTRAINT v2_daily_maintenance_jobs_activation_cursor_check CHECK ((((activation_cursor_event IS NULL) AND (activation_cursor_user_id IS NULL)) OR ((phase = 'activation'::text) AND (activation_cursor_event = ANY (ARRAY['retention_d7'::text, 'retention_d28'::text, 'first_week_mau'::text])) AND (activation_cursor_user_id IS NOT NULL)))),
    CONSTRAINT v2_daily_maintenance_jobs_counter_check CHECK (((continuation >= 0) AND (failure_count >= 0))),
    CONSTRAINT v2_daily_maintenance_jobs_day_check CHECK ((day = (((scheduled_at AT TIME ZONE 'UTC'::text))::date - 1))),
    CONSTRAINT v2_daily_maintenance_jobs_error_code_check CHECK (((last_error_code IS NULL) OR (octet_length(last_error_code) <= 128))),
    CONSTRAINT v2_daily_maintenance_jobs_lease_check CHECK ((((status = 'leased'::text) AND (release_version_id IS NOT NULL) AND (lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (completed_at IS NULL)) OR ((status = 'queued'::text) AND (release_version_id IS NULL) AND (lease_token IS NULL) AND (lease_expires_at IS NULL) AND (completed_at IS NULL)) OR ((status = 'complete'::text) AND (release_version_id IS NULL) AND (lease_token IS NULL) AND (lease_expires_at IS NULL) AND (completed_at IS NOT NULL)))),
    CONSTRAINT v2_daily_maintenance_jobs_phase_check CHECK ((phase = ANY (ARRAY['activation'::text, 'orphan-upload-cleanup'::text]))),
    CONSTRAINT v2_daily_maintenance_jobs_phase_cursor_check CHECK (((phase = 'activation'::text) OR ((phase = 'orphan-upload-cleanup'::text) AND (activation_cursor_event IS NULL) AND (activation_cursor_user_id IS NULL)))),
    CONSTRAINT v2_daily_maintenance_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'leased'::text, 'complete'::text]))),
    CONSTRAINT v2_daily_maintenance_jobs_terminal_phase_check CHECK (((status <> 'complete'::text) OR (phase = 'orphan-upload-cleanup'::text)))
);

ALTER TABLE ONLY public.v2_daily_maintenance_jobs FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE v2_daily_maintenance_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.v2_daily_maintenance_jobs IS 'Durable daily activation-metric and orphan-upload-cleanup workflow state.';


--
-- Name: v2_deleted_clerk_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_deleted_clerk_identities (
    clerk_identity_hash text NOT NULL,
    CONSTRAINT v2_deleted_clerk_identities_hash_check CHECK ((clerk_identity_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY public.v2_deleted_clerk_identities FORCE ROW LEVEL SECURITY;


--
-- Name: v2_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_entitlements (
    user_id uuid NOT NULL,
    tier text DEFAULT 'free'::text NOT NULL,
    polar_subscription_id text,
    subscription_status text DEFAULT 'none'::text NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    CONSTRAINT v2_entitlements_period_order_check CHECK (((current_period_start IS NULL) OR (current_period_end IS NULL) OR (current_period_start <= current_period_end))),
    CONSTRAINT v2_entitlements_tier_check CHECK ((tier = ANY (ARRAY['free'::text, 'pro'::text, 'premium'::text, 'ultra'::text, 'max'::text])))
);

ALTER TABLE ONLY public.v2_entitlements FORCE ROW LEVEL SECURITY;


--
-- Name: v2_generated_outputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_generated_outputs (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    agent_run_id uuid NOT NULL,
    filename text NOT NULL,
    r2_key text NOT NULL,
    mime_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT v2_generated_outputs_filename_check CHECK (((btrim(filename) <> ''::text) AND (length(filename) <= 255))),
    CONSTRAINT v2_generated_outputs_key_check CHECK (((btrim(r2_key) <> ''::text) AND (length(r2_key) <= 1024))),
    CONSTRAINT v2_generated_outputs_mime_type_check CHECK (((btrim(mime_type) <> ''::text) AND (length(mime_type) <= 255))),
    CONSTRAINT v2_generated_outputs_r2_identity_check CHECK (((r2_key = (((((((((user_id)::text || '/'::text) || split_part(r2_key, '/'::text, 2)) || '/'::text) || (agent_run_id)::text) || '/'::text) || (id)::text) || '-'::text) || filename)) AND (split_part(r2_key, '/'::text, 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'::text) AND (strpos(filename, '/'::text) = 0)))
);

ALTER TABLE ONLY public.v2_generated_outputs FORCE ROW LEVEL SECURITY;


--
-- Name: v2_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_messages (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    parts jsonb NOT NULL,
    agent_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_run_segment integer DEFAULT 0 NOT NULL,
    agent_run_segment_final boolean DEFAULT true NOT NULL,
    CONSTRAINT v2_messages_agent_run_segment_check CHECK ((agent_run_segment >= 0)),
    CONSTRAINT v2_messages_agent_run_segment_scope_check CHECK ((((agent_run_segment = 0) AND agent_run_segment_final) OR ((role = 'assistant'::text) AND (agent_run_id IS NOT NULL)))),
    CONSTRAINT v2_messages_parts_array_check CHECK ((jsonb_typeof(parts) = 'array'::text)),
    CONSTRAINT v2_messages_parts_size_check CHECK ((octet_length((parts)::text) <= 196608)),
    CONSTRAINT v2_messages_role_check CHECK ((role = ANY (ARRAY['assistant'::text, 'user'::text])))
);

ALTER TABLE ONLY public.v2_messages FORCE ROW LEVEL SECURITY;


--
-- Name: v2_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_projects (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    mode text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp(3) with time zone,
    over_quota boolean DEFAULT false NOT NULL,
    archive_after timestamp with time zone,
    workspace_slug text NOT NULL,
    CONSTRAINT v2_projects_mode_check CHECK ((mode = ANY (ARRAY['app-builder'::text, 'app-builder-mobile'::text, 'general'::text]))),
    CONSTRAINT v2_projects_quota_archive_pair_check CHECK ((over_quota = (archive_after IS NOT NULL))),
    CONSTRAINT v2_projects_settings_default_model_check CHECK (((NOT (settings ? 'defaultModel'::text)) OR ((jsonb_typeof((settings -> 'defaultModel'::text)) = 'string'::text) AND (char_length((settings ->> 'defaultModel'::text)) <= 200) AND ((settings ->> 'defaultModel'::text) ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'::text)))),
    CONSTRAINT v2_projects_settings_object_check CHECK ((jsonb_typeof(settings) = 'object'::text)),
    CONSTRAINT v2_projects_workspace_slug_canonical_check CHECK ((((octet_length(workspace_slug) >= 38) AND (octet_length(workspace_slug) <= 64)) AND ("right"(workspace_slug, 37) = ('-'::text || (id)::text)) AND ("left"(workspace_slug, (length(workspace_slug) - 37)) ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)))
);

ALTER TABLE ONLY public.v2_projects FORCE ROW LEVEL SECURITY;


--
-- Name: v2_provider_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_provider_keys (
    user_id uuid NOT NULL,
    provider text NOT NULL,
    vault_secret_id uuid NOT NULL,
    fingerprint text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    disabled_at timestamp with time zone,
    disabled_reason text,
    last_revalidated_at timestamp with time zone,
    revalidation_claimed_at timestamp with time zone,
    revalidation_lease_token uuid,
    CONSTRAINT v2_provider_keys_disabled_pair_check CHECK ((((disabled_at IS NULL) AND (disabled_reason IS NULL)) OR ((disabled_at IS NOT NULL) AND (disabled_reason IS NOT NULL)))),
    CONSTRAINT v2_provider_keys_fingerprint_check CHECK ((fingerprint ~ '^[0-9a-f]{12}$'::text)),
    CONSTRAINT v2_provider_keys_provider_check CHECK ((provider = ANY (ARRAY['anthropic'::text, 'openai'::text, 'google'::text, 'openrouter'::text, 'deepseek'::text, 'exa'::text, 'firecrawl'::text]))),
    CONSTRAINT v2_provider_keys_revalidation_lease_pair_check CHECK ((((revalidation_claimed_at IS NULL) AND (revalidation_lease_token IS NULL)) OR ((revalidation_claimed_at IS NOT NULL) AND (revalidation_lease_token IS NOT NULL))))
);

ALTER TABLE ONLY public.v2_provider_keys FORCE ROW LEVEL SECURITY;


--
-- Name: v2_resource_deletion_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_resource_deletion_jobs (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    resource_id uuid NOT NULL,
    generation timestamp(3) with time zone NOT NULL,
    phase text DEFAULT 'runs'::text NOT NULL,
    cursor uuid,
    continuation integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp(3) with time zone,
    failure_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    last_error_code text,
    CONSTRAINT v2_resource_deletion_jobs_counter_check CHECK (((continuation >= 0) AND (failure_count >= 0))),
    CONSTRAINT v2_resource_deletion_jobs_kind_check CHECK ((kind = ANY (ARRAY['project-deletion'::text, 'thread-deletion'::text]))),
    CONSTRAINT v2_resource_deletion_jobs_lease_check CHECK ((((status = 'leased'::text) AND (lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL)) OR ((status <> 'leased'::text) AND (lease_token IS NULL) AND (lease_expires_at IS NULL)))),
    CONSTRAINT v2_resource_deletion_jobs_phase_check CHECK ((phase = ANY (ARRAY['runs'::text, 'run-objects'::text, 'workspace'::text, 'outputs'::text, 'prefix'::text, 'pointer'::text, 'finalize'::text]))),
    CONSTRAINT v2_resource_deletion_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'leased'::text, 'quarantined'::text])))
);

ALTER TABLE ONLY public.v2_resource_deletion_jobs FORCE ROW LEVEL SECURITY;


--
-- Name: v2_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_threads (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    project_id uuid,
    user_id uuid NOT NULL,
    title text,
    active_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp(3) with time zone,
    launch_intent jsonb,
    latest_model_id text,
    CONSTRAINT v2_threads_latest_model_id_check CHECK (((latest_model_id IS NULL) OR ((char_length(latest_model_id) <= 200) AND (latest_model_id ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'::text)))),
    CONSTRAINT v2_threads_launch_default_model_check CHECK (((launch_intent IS NULL) OR (NOT (launch_intent ? 'defaultModel'::text)) OR ((jsonb_typeof((launch_intent -> 'defaultModel'::text)) = 'string'::text) AND (char_length((launch_intent ->> 'defaultModel'::text)) <= 200) AND ((launch_intent ->> 'defaultModel'::text) ~ '^(anthropic|deepseek|google|openai|openrouter)/[^[:space:]]+$'::text)))),
    CONSTRAINT v2_threads_launch_intent_object_check CHECK (((launch_intent IS NULL) OR (jsonb_typeof(launch_intent) = 'object'::text))),
    CONSTRAINT v2_threads_project_launch_intent_check CHECK (((project_id IS NULL) OR (launch_intent IS NULL)))
);

ALTER TABLE ONLY public.v2_threads FORCE ROW LEVEL SECURITY;


--
-- Name: v2_user_deletion_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_user_deletion_jobs (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    generation timestamp with time zone NOT NULL,
    phase text DEFAULT 'runs'::text NOT NULL,
    cursor text,
    continuation integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp(3) with time zone,
    failure_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    last_error_code text,
    CONSTRAINT v2_user_deletion_jobs_counter_check CHECK (((continuation >= 0) AND (failure_count >= 0))),
    CONSTRAINT v2_user_deletion_jobs_lease_check CHECK ((((status = 'leased'::text) AND (lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL)) OR ((status <> 'leased'::text) AND (lease_token IS NULL) AND (lease_expires_at IS NULL)))),
    CONSTRAINT v2_user_deletion_jobs_phase_check CHECK ((phase = ANY (ARRAY['runs'::text, 'sandbox'::text, 'billing'::text, 'quota'::text, 'integrations'::text, 'objects'::text, 'archive'::text, 'finalize'::text]))),
    CONSTRAINT v2_user_deletion_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'leased'::text, 'quarantined'::text])))
);

ALTER TABLE ONLY public.v2_user_deletion_jobs FORCE ROW LEVEL SECURITY;


--
-- Name: v2_user_deletion_refund_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_user_deletion_refund_intents (
    job_id uuid NOT NULL,
    user_id uuid NOT NULL,
    generation timestamp with time zone NOT NULL,
    order_id text NOT NULL,
    amount integer NOT NULL,
    currency text NOT NULL,
    idempotency_key text NOT NULL,
    provider_refund_id text,
    provider_status text,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    reconciled_at timestamp(3) with time zone,
    CONSTRAINT v2_user_deletion_refund_intents_amount_check CHECK ((amount > 0)),
    CONSTRAINT v2_user_deletion_refund_intents_currency_check CHECK ((currency ~ '^[a-z]{3}$'::text)),
    CONSTRAINT v2_user_deletion_refund_intents_identity_check CHECK ((idempotency_key = ('cheatcode:user-deletion-refund:'::text || (job_id)::text))),
    CONSTRAINT v2_user_deletion_refund_intents_order_check CHECK ((length(btrim(order_id)) > 0)),
    CONSTRAINT v2_user_deletion_refund_intents_provider_check CHECK ((((provider_refund_id IS NULL) AND (provider_status IS NULL) AND (reconciled_at IS NULL)) OR ((provider_refund_id IS NOT NULL) AND (length(btrim(provider_refund_id)) > 0) AND (provider_status IS NOT NULL) AND (provider_status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text])) AND (reconciled_at IS NOT NULL))))
);

ALTER TABLE ONLY public.v2_user_deletion_refund_intents FORCE ROW LEVEL SECURITY;


--
-- Name: v2_user_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_user_integrations (
    user_id uuid NOT NULL,
    integration text NOT NULL,
    composio_connection_id text NOT NULL,
    status text NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    CONSTRAINT v2_user_integrations_connection_id_check CHECK (((composio_connection_id = btrim(composio_connection_id)) AND ((length(composio_connection_id) >= 1) AND (length(composio_connection_id) <= 256)))),
    CONSTRAINT v2_user_integrations_default_active_check CHECK (((NOT is_default) OR (lower(status) = ANY (ARRAY['active'::text, 'authorized'::text, 'connected'::text, 'enabled'::text])))),
    CONSTRAINT v2_user_integrations_integration_check CHECK ((integration ~ '^[a-z0-9_]{1,64}$'::text))
);

ALTER TABLE ONLY public.v2_user_integrations FORCE ROW LEVEL SECURITY;


--
-- Name: v2_user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_user_profiles (
    user_id uuid NOT NULL,
    agent_display_name text,
    global_memory text,
    disabled_models jsonb DEFAULT '[]'::jsonb NOT NULL,
    onboarding_completed_at timestamp with time zone,
    onboarding_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT v2_user_profiles_disabled_models_array_check CHECK ((jsonb_typeof(disabled_models) = 'array'::text)),
    CONSTRAINT v2_user_profiles_onboarding_state_object_check CHECK ((jsonb_typeof(onboarding_state) = 'object'::text))
);

ALTER TABLE ONLY public.v2_user_profiles FORCE ROW LEVEL SECURITY;


--
-- Name: v2_user_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_user_skills (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT v2_user_skills_tags_array_check CHECK ((jsonb_typeof(tags) = 'array'::text))
);

ALTER TABLE ONLY public.v2_user_skills FORCE ROW LEVEL SECURITY;


--
-- Name: v2_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.v2_users (
    id uuid DEFAULT public.uuidv7() NOT NULL,
    clerk_id text NOT NULL,
    email text NOT NULL,
    polar_customer_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    display_name text,
    avatar_url text,
    deletion_fence text,
    first_artifact_at timestamp with time zone,
    clerk_updated_at_ms bigint NOT NULL,
    CONSTRAINT v2_users_clerk_updated_at_ms_check CHECK (((clerk_updated_at_ms >= 0) AND (clerk_updated_at_ms <= '9007199254740991'::bigint)))
);

ALTER TABLE ONLY public.v2_users FORCE ROW LEVEL SECURITY;


--
-- Name: v2_agent_runs v2_agent_runs_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_agent_runs
    ADD CONSTRAINT v2_agent_runs_id_user_id_key UNIQUE (id, user_id);


--
-- Name: v2_agent_runs v2_agent_runs_id_user_id_thread_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_agent_runs
    ADD CONSTRAINT v2_agent_runs_id_user_id_thread_id_key UNIQUE (id, user_id, thread_id);


--
-- Name: v2_agent_runs v2_agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_agent_runs
    ADD CONSTRAINT v2_agent_runs_pkey PRIMARY KEY (id);


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_artifact_upload_intents
    ADD CONSTRAINT v2_artifact_upload_intents_pkey PRIMARY KEY (id);


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_r2_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_artifact_upload_intents
    ADD CONSTRAINT v2_artifact_upload_intents_r2_key_unique UNIQUE (r2_key);


--
-- Name: v2_audit_log v2_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_audit_log
    ADD CONSTRAINT v2_audit_log_pkey PRIMARY KEY (id);


--
-- Name: v2_daily_maintenance_jobs v2_daily_maintenance_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_daily_maintenance_jobs
    ADD CONSTRAINT v2_daily_maintenance_jobs_pkey PRIMARY KEY (day);


--
-- Name: v2_deleted_clerk_identities v2_deleted_clerk_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_deleted_clerk_identities
    ADD CONSTRAINT v2_deleted_clerk_identities_pkey PRIMARY KEY (clerk_identity_hash);


--
-- Name: v2_entitlements v2_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_entitlements
    ADD CONSTRAINT v2_entitlements_pkey PRIMARY KEY (user_id);


--
-- Name: v2_generated_outputs v2_generated_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_generated_outputs
    ADD CONSTRAINT v2_generated_outputs_pkey PRIMARY KEY (id);


--
-- Name: v2_generated_outputs v2_generated_outputs_r2_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_generated_outputs
    ADD CONSTRAINT v2_generated_outputs_r2_key_unique UNIQUE (r2_key);


--
-- Name: v2_messages v2_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_messages
    ADD CONSTRAINT v2_messages_pkey PRIMARY KEY (id);


--
-- Name: v2_projects v2_projects_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_projects
    ADD CONSTRAINT v2_projects_id_user_id_key UNIQUE (id, user_id);


--
-- Name: v2_projects v2_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_projects
    ADD CONSTRAINT v2_projects_pkey PRIMARY KEY (id);


--
-- Name: v2_provider_keys v2_provider_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_provider_keys
    ADD CONSTRAINT v2_provider_keys_pkey PRIMARY KEY (user_id, provider);


--
-- Name: v2_resource_deletion_jobs v2_resource_deletion_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_resource_deletion_jobs
    ADD CONSTRAINT v2_resource_deletion_jobs_pkey PRIMARY KEY (id);


--
-- Name: v2_threads v2_threads_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_threads
    ADD CONSTRAINT v2_threads_id_user_id_key UNIQUE (id, user_id);


--
-- Name: v2_threads v2_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_threads
    ADD CONSTRAINT v2_threads_pkey PRIMARY KEY (id);


--
-- Name: v2_user_deletion_jobs v2_user_deletion_jobs_id_user_generation_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_deletion_jobs
    ADD CONSTRAINT v2_user_deletion_jobs_id_user_generation_key UNIQUE (id, user_id, generation);


--
-- Name: v2_user_deletion_jobs v2_user_deletion_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_deletion_jobs
    ADD CONSTRAINT v2_user_deletion_jobs_pkey PRIMARY KEY (id);


--
-- Name: v2_user_deletion_refund_intents v2_user_deletion_refund_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_deletion_refund_intents
    ADD CONSTRAINT v2_user_deletion_refund_intents_pkey PRIMARY KEY (job_id);


--
-- Name: v2_user_integrations v2_user_integrations_composio_connection_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_integrations
    ADD CONSTRAINT v2_user_integrations_composio_connection_id_pk PRIMARY KEY (composio_connection_id);


--
-- Name: v2_user_profiles v2_user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_profiles
    ADD CONSTRAINT v2_user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: v2_user_skills v2_user_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_skills
    ADD CONSTRAINT v2_user_skills_pkey PRIMARY KEY (id);


--
-- Name: v2_users v2_users_clerk_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_users
    ADD CONSTRAINT v2_users_clerk_id_unique UNIQUE (clerk_id);


--
-- Name: v2_users v2_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_users
    ADD CONSTRAINT v2_users_pkey PRIMARY KEY (id);


--
-- Name: v2_users v2_users_polar_customer_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_users
    ADD CONSTRAINT v2_users_polar_customer_id_unique UNIQUE (polar_customer_id);


--
-- Name: v2_agent_runs_thread_delete_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_agent_runs_thread_delete_page_idx ON public.v2_agent_runs USING btree (user_id, thread_id, id);


--
-- Name: v2_agent_runs_thread_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_agent_runs_thread_started_idx ON public.v2_agent_runs USING btree (thread_id, started_at DESC);


--
-- Name: v2_agent_runs_user_delete_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_agent_runs_user_delete_page_idx ON public.v2_agent_runs USING btree (user_id, id);


--
-- Name: v2_agent_runs_user_finished_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_agent_runs_user_finished_idx ON public.v2_agent_runs USING btree (user_id, finished_at) WHERE (finished_at IS NOT NULL);


--
-- Name: v2_agent_runs_user_idempotency_key_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_agent_runs_user_idempotency_key_unique ON public.v2_agent_runs USING btree (user_id, idempotency_key_hash);


--
-- Name: v2_agent_runs_user_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_agent_runs_user_started_idx ON public.v2_agent_runs USING btree (user_id, started_at DESC);


--
-- Name: v2_artifact_upload_intents_cleanup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_artifact_upload_intents_cleanup_idx ON public.v2_artifact_upload_intents USING btree (cleanup_not_before, quiesced_at, id) WHERE (quiesced_at IS NOT NULL);


--
-- Name: v2_artifact_upload_intents_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_artifact_upload_intents_project_idx ON public.v2_artifact_upload_intents USING btree (user_id, project_id, id);


--
-- Name: v2_artifact_upload_intents_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_artifact_upload_intents_run_idx ON public.v2_artifact_upload_intents USING btree (user_id, agent_run_id, id);


--
-- Name: v2_artifact_upload_intents_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_artifact_upload_intents_user_idx ON public.v2_artifact_upload_intents USING btree (user_id, id);


--
-- Name: v2_audit_log_action_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_audit_log_action_created_idx ON public.v2_audit_log USING btree (action, created_at DESC NULLS LAST);


--
-- Name: v2_audit_log_created_brin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_audit_log_created_brin_idx ON public.v2_audit_log USING brin (created_at);


--
-- Name: v2_audit_log_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_audit_log_user_created_idx ON public.v2_audit_log USING btree (user_id, created_at DESC NULLS LAST);


--
-- Name: v2_daily_maintenance_jobs_completed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_daily_maintenance_jobs_completed_idx ON public.v2_daily_maintenance_jobs USING btree (completed_at, day) WHERE (status = 'complete'::text);


--
-- Name: v2_daily_maintenance_jobs_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_daily_maintenance_jobs_lease_idx ON public.v2_daily_maintenance_jobs USING btree (lease_expires_at, day) WHERE (status = 'leased'::text);


--
-- Name: v2_daily_maintenance_jobs_ready_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_daily_maintenance_jobs_ready_idx ON public.v2_daily_maintenance_jobs USING btree (next_attempt_at, day) WHERE (status = 'queued'::text);


--
-- Name: v2_entitlements_polar_subscription_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_entitlements_polar_subscription_uidx ON public.v2_entitlements USING btree (polar_subscription_id) WHERE (polar_subscription_id IS NOT NULL);


--
-- Name: v2_generated_outputs_agent_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_generated_outputs_agent_run_idx ON public.v2_generated_outputs USING btree (agent_run_id);


--
-- Name: v2_generated_outputs_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_generated_outputs_user_created_idx ON public.v2_generated_outputs USING btree (user_id, created_at DESC);


--
-- Name: v2_messages_agent_run_final_assistant_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_messages_agent_run_final_assistant_uidx ON public.v2_messages USING btree (agent_run_id) WHERE ((agent_run_id IS NOT NULL) AND (role = 'assistant'::text) AND agent_run_segment_final);


--
-- Name: v2_messages_agent_run_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_messages_agent_run_scope_idx ON public.v2_messages USING btree (agent_run_id, user_id, thread_id);


--
-- Name: v2_messages_agent_run_segment_assistant_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_messages_agent_run_segment_assistant_uidx ON public.v2_messages USING btree (agent_run_id, agent_run_segment) WHERE ((agent_run_id IS NOT NULL) AND (role = 'assistant'::text));


--
-- Name: v2_messages_thread_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_messages_thread_page_idx ON public.v2_messages USING btree (user_id, thread_id, created_at, agent_run_segment, id);


--
-- Name: v2_projects_deletion_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_projects_deletion_queue_idx ON public.v2_projects USING btree (deleted_at, id) WHERE (deleted_at IS NOT NULL);


--
-- Name: v2_projects_user_delete_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_projects_user_delete_idx ON public.v2_projects USING btree (user_id, id);


--
-- Name: v2_projects_user_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_projects_user_page_idx ON public.v2_projects USING btree (user_id, updated_at DESC NULLS LAST, id DESC NULLS LAST) WHERE (deleted_at IS NULL);


--
-- Name: v2_provider_keys_revalidation_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_provider_keys_revalidation_lease_idx ON public.v2_provider_keys USING btree (last_revalidated_at NULLS FIRST, revalidation_claimed_at NULLS FIRST, created_at, user_id, provider) WHERE (disabled_at IS NULL);


--
-- Name: v2_provider_keys_vault_secret_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_provider_keys_vault_secret_uidx ON public.v2_provider_keys USING btree (vault_secret_id);


--
-- Name: v2_resource_deletion_jobs_generation_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_resource_deletion_jobs_generation_uidx ON public.v2_resource_deletion_jobs USING btree (kind, resource_id, generation);


--
-- Name: v2_resource_deletion_jobs_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_resource_deletion_jobs_lease_idx ON public.v2_resource_deletion_jobs USING btree (lease_expires_at, id) WHERE (status = 'leased'::text);


--
-- Name: v2_resource_deletion_jobs_ready_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_resource_deletion_jobs_ready_idx ON public.v2_resource_deletion_jobs USING btree (next_attempt_at, id) WHERE (status = 'queued'::text);


--
-- Name: v2_resource_deletion_jobs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_resource_deletion_jobs_user_idx ON public.v2_resource_deletion_jobs USING btree (user_id);


--
-- Name: v2_threads_active_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_threads_active_run_idx ON public.v2_threads USING btree (active_run_id) WHERE (active_run_id IS NOT NULL);


--
-- Name: v2_threads_deletion_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_threads_deletion_queue_idx ON public.v2_threads USING btree (deleted_at, id) WHERE (deleted_at IS NOT NULL);


--
-- Name: v2_threads_project_delete_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_threads_project_delete_idx ON public.v2_threads USING btree (user_id, project_id, id);


--
-- Name: v2_threads_project_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_threads_project_page_idx ON public.v2_threads USING btree (user_id, project_id, updated_at DESC NULLS LAST, id DESC NULLS LAST) WHERE (deleted_at IS NULL);


--
-- Name: v2_threads_user_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_threads_user_page_idx ON public.v2_threads USING btree (user_id, updated_at DESC NULLS LAST, id DESC NULLS LAST) WHERE (deleted_at IS NULL);


--
-- Name: v2_user_deletion_jobs_generation_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_user_deletion_jobs_generation_uidx ON public.v2_user_deletion_jobs USING btree (user_id, generation);


--
-- Name: v2_user_deletion_jobs_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_user_deletion_jobs_lease_idx ON public.v2_user_deletion_jobs USING btree (lease_expires_at, id) WHERE (status = 'leased'::text);


--
-- Name: v2_user_deletion_jobs_ready_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_user_deletion_jobs_ready_idx ON public.v2_user_deletion_jobs USING btree (next_attempt_at, id) WHERE (status = 'queued'::text);


--
-- Name: v2_user_deletion_refund_intents_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_user_deletion_refund_intents_idempotency_uidx ON public.v2_user_deletion_refund_intents USING btree (idempotency_key);


--
-- Name: v2_user_deletion_refund_intents_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_user_deletion_refund_intents_provider_uidx ON public.v2_user_deletion_refund_intents USING btree (provider_refund_id) WHERE (provider_refund_id IS NOT NULL);


--
-- Name: v2_user_deletion_refund_intents_unresolved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_user_deletion_refund_intents_unresolved_idx ON public.v2_user_deletion_refund_intents USING btree (user_id, job_id) WHERE (provider_status IS DISTINCT FROM 'succeeded'::text);


--
-- Name: v2_user_integrations_delete_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_user_integrations_delete_page_idx ON public.v2_user_integrations USING btree (user_id, composio_connection_id);


--
-- Name: v2_user_integrations_one_default_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_user_integrations_one_default_idx ON public.v2_user_integrations USING btree (user_id, integration) WHERE (is_default = true);


--
-- Name: v2_user_integrations_user_toolkit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_user_integrations_user_toolkit_idx ON public.v2_user_integrations USING btree (user_id, integration);


--
-- Name: v2_user_skills_user_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX v2_user_skills_user_name_idx ON public.v2_user_skills USING btree (user_id, name);


--
-- Name: v2_users_activation_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_users_activation_created_idx ON public.v2_users USING btree (created_at, id) WHERE (deleted_at IS NULL);


--
-- Name: v2_users_deletion_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX v2_users_deletion_due_idx ON public.v2_users USING btree (deleted_at, id) WHERE (deleted_at IS NOT NULL);


--
-- Name: v2_agent_runs trg_v2_agent_runs_terminal_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_agent_runs_terminal_state BEFORE UPDATE OF finished_at, status ON public.v2_agent_runs FOR EACH ROW EXECUTE FUNCTION public.v2_guard_terminal_agent_run_state();


--
-- Name: v2_provider_keys trg_v2_audit_provider_keys; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_audit_provider_keys AFTER INSERT OR DELETE OR UPDATE ON public.v2_provider_keys FOR EACH ROW EXECUTE FUNCTION public.v2_audit_provider_key_change();


--
-- Name: v2_entitlements trg_v2_entitlements_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_entitlements_updated BEFORE UPDATE ON public.v2_entitlements FOR EACH ROW EXECUTE FUNCTION public.v2_touch_updated_at();


--
-- Name: v2_projects trg_v2_projects_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_projects_updated BEFORE UPDATE ON public.v2_projects FOR EACH ROW EXECUTE FUNCTION public.v2_touch_updated_at();


--
-- Name: v2_provider_keys trg_v2_provider_keys_delete_vault; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_provider_keys_delete_vault BEFORE DELETE ON public.v2_provider_keys FOR EACH ROW EXECUTE FUNCTION public.v2_delete_provider_vault_secret();


--
-- Name: v2_threads trg_v2_threads_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_threads_updated BEFORE UPDATE ON public.v2_threads FOR EACH ROW EXECUTE FUNCTION public.v2_touch_updated_at();


--
-- Name: v2_user_deletion_jobs trg_v2_user_deletion_refund_resolution; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_user_deletion_refund_resolution BEFORE DELETE OR UPDATE OF phase ON public.v2_user_deletion_jobs FOR EACH ROW EXECUTE FUNCTION public.v2_guard_user_deletion_refund_resolution();


--
-- Name: v2_user_integrations trg_v2_user_integrations_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_user_integrations_updated BEFORE UPDATE ON public.v2_user_integrations FOR EACH ROW EXECUTE FUNCTION public.v2_touch_updated_at();


--
-- Name: v2_user_profiles trg_v2_user_profiles_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_v2_user_profiles_updated BEFORE UPDATE ON public.v2_user_profiles FOR EACH ROW EXECUTE FUNCTION public.v2_touch_updated_at();


--
-- Name: v2_entitlements v2_audit_entitlement_change_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER v2_audit_entitlement_change_trigger AFTER INSERT OR DELETE OR UPDATE ON public.v2_entitlements FOR EACH ROW EXECUTE FUNCTION public.v2_audit_entitlement_change();


--
-- Name: v2_user_integrations v2_audit_integration_change_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER v2_audit_integration_change_trigger AFTER INSERT OR DELETE OR UPDATE ON public.v2_user_integrations FOR EACH ROW EXECUTE FUNCTION public.v2_audit_integration_change();


--
-- Name: v2_agent_runs v2_agent_runs_thread_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_agent_runs
    ADD CONSTRAINT v2_agent_runs_thread_user_fk FOREIGN KEY (thread_id, user_id) REFERENCES public.v2_threads(id, user_id) ON DELETE CASCADE;


--
-- Name: v2_agent_runs v2_agent_runs_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_agent_runs
    ADD CONSTRAINT v2_agent_runs_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_agent_run_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_artifact_upload_intents
    ADD CONSTRAINT v2_artifact_upload_intents_agent_run_user_fk FOREIGN KEY (agent_run_id, user_id) REFERENCES public.v2_agent_runs(id, user_id);


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_project_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_artifact_upload_intents
    ADD CONSTRAINT v2_artifact_upload_intents_project_user_fk FOREIGN KEY (project_id, user_id) REFERENCES public.v2_projects(id, user_id);


--
-- Name: v2_entitlements v2_entitlements_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_entitlements
    ADD CONSTRAINT v2_entitlements_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_generated_outputs v2_generated_outputs_agent_run_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_generated_outputs
    ADD CONSTRAINT v2_generated_outputs_agent_run_user_fk FOREIGN KEY (agent_run_id, user_id) REFERENCES public.v2_agent_runs(id, user_id) ON DELETE RESTRICT;


--
-- Name: v2_generated_outputs v2_generated_outputs_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_generated_outputs
    ADD CONSTRAINT v2_generated_outputs_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_messages v2_messages_agent_run_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_messages
    ADD CONSTRAINT v2_messages_agent_run_scope_fk FOREIGN KEY (agent_run_id, user_id, thread_id) REFERENCES public.v2_agent_runs(id, user_id, thread_id) ON DELETE RESTRICT;


--
-- Name: v2_messages v2_messages_thread_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_messages
    ADD CONSTRAINT v2_messages_thread_user_fk FOREIGN KEY (thread_id, user_id) REFERENCES public.v2_threads(id, user_id) ON DELETE CASCADE;


--
-- Name: v2_messages v2_messages_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_messages
    ADD CONSTRAINT v2_messages_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_projects v2_projects_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_projects
    ADD CONSTRAINT v2_projects_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_provider_keys v2_provider_keys_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_provider_keys
    ADD CONSTRAINT v2_provider_keys_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_resource_deletion_jobs v2_resource_deletion_jobs_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_resource_deletion_jobs
    ADD CONSTRAINT v2_resource_deletion_jobs_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_threads v2_threads_active_run_scope_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_threads
    ADD CONSTRAINT v2_threads_active_run_scope_fk FOREIGN KEY (active_run_id, user_id, id) REFERENCES public.v2_agent_runs(id, user_id, thread_id) ON DELETE SET NULL (active_run_id);


--
-- Name: v2_threads v2_threads_project_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_threads
    ADD CONSTRAINT v2_threads_project_user_fk FOREIGN KEY (project_id, user_id) REFERENCES public.v2_projects(id, user_id) ON DELETE CASCADE;


--
-- Name: v2_threads v2_threads_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_threads
    ADD CONSTRAINT v2_threads_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_user_deletion_jobs v2_user_deletion_jobs_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_deletion_jobs
    ADD CONSTRAINT v2_user_deletion_jobs_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_user_deletion_refund_intents v2_user_deletion_refund_intents_job_identity_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_deletion_refund_intents
    ADD CONSTRAINT v2_user_deletion_refund_intents_job_identity_fk FOREIGN KEY (job_id, user_id, generation) REFERENCES public.v2_user_deletion_jobs(id, user_id, generation) ON DELETE CASCADE;


--
-- Name: v2_user_integrations v2_user_integrations_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_integrations
    ADD CONSTRAINT v2_user_integrations_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_user_profiles v2_user_profiles_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_profiles
    ADD CONSTRAINT v2_user_profiles_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_user_skills v2_user_skills_user_id_v2_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.v2_user_skills
    ADD CONSTRAINT v2_user_skills_user_id_v2_users_id_fk FOREIGN KEY (user_id) REFERENCES public.v2_users(id) ON DELETE CASCADE;


--
-- Name: v2_agent_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_agent_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_agent_runs v2_agent_runs_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_agent_runs_insert_own ON public.v2_agent_runs FOR INSERT TO app_agent WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_agent_runs v2_agent_runs_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_agent_runs_postgres_all ON public.v2_agent_runs TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_agent_runs v2_agent_runs_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_agent_runs_select_own ON public.v2_agent_runs FOR SELECT TO app_gateway, app_agent, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_agent_runs v2_agent_runs_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_agent_runs_update_own ON public.v2_agent_runs FOR UPDATE TO app_agent USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_artifact_upload_intents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_artifact_upload_intents ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_delete_maintenance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_artifact_upload_intents_delete_maintenance ON public.v2_artifact_upload_intents FOR DELETE TO app_webhooks USING (true);


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_artifact_upload_intents_delete_own ON public.v2_artifact_upload_intents FOR DELETE TO app_agent USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_artifact_upload_intents_insert_own ON public.v2_artifact_upload_intents FOR INSERT TO app_agent WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_artifact_upload_intents_postgres_all ON public.v2_artifact_upload_intents TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_select_maintenance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_artifact_upload_intents_select_maintenance ON public.v2_artifact_upload_intents FOR SELECT TO app_webhooks USING (true);


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_artifact_upload_intents_select_own ON public.v2_artifact_upload_intents FOR SELECT TO app_agent USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_artifact_upload_intents v2_artifact_upload_intents_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_artifact_upload_intents_update_own ON public.v2_artifact_upload_intents FOR UPDATE TO app_agent USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_audit_log ENABLE ROW LEVEL SECURITY;


--
-- Name: v2_audit_log v2_audit_log_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_audit_log_postgres_all ON public.v2_audit_log TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_daily_maintenance_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_daily_maintenance_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_daily_maintenance_jobs v2_daily_maintenance_jobs_delete_maintenance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_daily_maintenance_jobs_delete_maintenance ON public.v2_daily_maintenance_jobs FOR DELETE TO app_webhooks USING (true);


--
-- Name: v2_daily_maintenance_jobs v2_daily_maintenance_jobs_insert_maintenance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_daily_maintenance_jobs_insert_maintenance ON public.v2_daily_maintenance_jobs FOR INSERT TO app_webhooks WITH CHECK (true);


--
-- Name: v2_daily_maintenance_jobs v2_daily_maintenance_jobs_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_daily_maintenance_jobs_postgres_all ON public.v2_daily_maintenance_jobs TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_daily_maintenance_jobs v2_daily_maintenance_jobs_select_maintenance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_daily_maintenance_jobs_select_maintenance ON public.v2_daily_maintenance_jobs FOR SELECT TO app_webhooks USING (true);


--
-- Name: v2_daily_maintenance_jobs v2_daily_maintenance_jobs_update_maintenance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_daily_maintenance_jobs_update_maintenance ON public.v2_daily_maintenance_jobs FOR UPDATE TO app_webhooks USING (true) WITH CHECK (true);


--
-- Name: v2_deleted_clerk_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_deleted_clerk_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_deleted_clerk_identities v2_deleted_clerk_identities_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_deleted_clerk_identities_postgres_all ON public.v2_deleted_clerk_identities TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_entitlements v2_entitlements_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_entitlements_insert_own ON public.v2_entitlements FOR INSERT TO app_gateway, app_webhooks WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_entitlements v2_entitlements_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_entitlements_postgres_all ON public.v2_entitlements TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_entitlements v2_entitlements_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_entitlements_select_own ON public.v2_entitlements FOR SELECT TO app_gateway, app_agent, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_entitlements v2_entitlements_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_entitlements_update_own ON public.v2_entitlements FOR UPDATE TO app_gateway, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_generated_outputs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_generated_outputs ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_generated_outputs v2_generated_outputs_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_generated_outputs_delete_own ON public.v2_generated_outputs FOR DELETE TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_generated_outputs v2_generated_outputs_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_generated_outputs_insert_own ON public.v2_generated_outputs FOR INSERT TO app_agent WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_generated_outputs v2_generated_outputs_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_generated_outputs_postgres_all ON public.v2_generated_outputs TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_generated_outputs v2_generated_outputs_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_generated_outputs_select_own ON public.v2_generated_outputs FOR SELECT TO app_agent, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_messages v2_messages_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_messages_insert_own ON public.v2_messages FOR INSERT TO app_agent WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_messages v2_messages_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_messages_postgres_all ON public.v2_messages TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_messages v2_messages_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_messages_select_own ON public.v2_messages FOR SELECT TO app_gateway, app_agent USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_projects ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_projects v2_projects_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_projects_delete_own ON public.v2_projects FOR DELETE TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_projects v2_projects_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_projects_insert_own ON public.v2_projects FOR INSERT TO app_gateway, app_agent WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_projects v2_projects_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_projects_postgres_all ON public.v2_projects TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_projects v2_projects_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_projects_select_own ON public.v2_projects FOR SELECT TO app_gateway, app_agent, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_projects v2_projects_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_projects_update_own ON public.v2_projects FOR UPDATE TO app_gateway, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_provider_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_provider_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_provider_keys v2_provider_keys_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_provider_keys_postgres_all ON public.v2_provider_keys TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_provider_keys v2_provider_keys_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_provider_keys_select_own ON public.v2_provider_keys FOR SELECT TO app_gateway, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_provider_keys v2_provider_keys_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_provider_keys_update_own ON public.v2_provider_keys FOR UPDATE TO app_gateway, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_resource_deletion_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_resource_deletion_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_resource_deletion_jobs v2_resource_deletion_jobs_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_resource_deletion_jobs_delete_own ON public.v2_resource_deletion_jobs FOR DELETE TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_resource_deletion_jobs v2_resource_deletion_jobs_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_resource_deletion_jobs_insert_own ON public.v2_resource_deletion_jobs FOR INSERT TO app_webhooks WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_resource_deletion_jobs v2_resource_deletion_jobs_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_resource_deletion_jobs_postgres_all ON public.v2_resource_deletion_jobs TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_resource_deletion_jobs v2_resource_deletion_jobs_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_resource_deletion_jobs_select_own ON public.v2_resource_deletion_jobs FOR SELECT TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_resource_deletion_jobs v2_resource_deletion_jobs_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_resource_deletion_jobs_update_own ON public.v2_resource_deletion_jobs FOR UPDATE TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_threads v2_threads_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_threads_delete_own ON public.v2_threads FOR DELETE TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_threads v2_threads_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_threads_insert_own ON public.v2_threads FOR INSERT TO app_gateway WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_threads v2_threads_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_threads_postgres_all ON public.v2_threads TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_threads v2_threads_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_threads_select_own ON public.v2_threads FOR SELECT TO app_gateway, app_agent, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_threads v2_threads_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_threads_update_own ON public.v2_threads FOR UPDATE TO app_gateway, app_agent, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_deletion_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_user_deletion_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_user_deletion_jobs v2_user_deletion_jobs_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_deletion_jobs_delete_own ON public.v2_user_deletion_jobs FOR DELETE TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_deletion_jobs v2_user_deletion_jobs_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_deletion_jobs_insert_own ON public.v2_user_deletion_jobs FOR INSERT TO app_webhooks WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_deletion_jobs v2_user_deletion_jobs_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_deletion_jobs_postgres_all ON public.v2_user_deletion_jobs TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_user_deletion_jobs v2_user_deletion_jobs_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_deletion_jobs_select_own ON public.v2_user_deletion_jobs FOR SELECT TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_deletion_jobs v2_user_deletion_jobs_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_deletion_jobs_update_own ON public.v2_user_deletion_jobs FOR UPDATE TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_deletion_refund_intents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_user_deletion_refund_intents ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_user_deletion_refund_intents v2_user_deletion_refund_intents_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_deletion_refund_intents_postgres_all ON public.v2_user_deletion_refund_intents TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_user_deletion_refund_intents v2_user_deletion_refund_intents_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_deletion_refund_intents_select_own ON public.v2_user_deletion_refund_intents FOR SELECT TO app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_user_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_user_integrations v2_user_integrations_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_integrations_delete_own ON public.v2_user_integrations FOR DELETE TO app_gateway USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_integrations v2_user_integrations_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_integrations_insert_own ON public.v2_user_integrations FOR INSERT TO app_gateway WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_integrations v2_user_integrations_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_integrations_postgres_all ON public.v2_user_integrations TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_user_integrations v2_user_integrations_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_integrations_select_own ON public.v2_user_integrations FOR SELECT TO app_gateway, app_agent, app_webhooks USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_integrations v2_user_integrations_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_integrations_update_own ON public.v2_user_integrations FOR UPDATE TO app_gateway USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_user_profiles v2_user_profiles_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_profiles_insert_own ON public.v2_user_profiles FOR INSERT TO app_gateway WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_profiles v2_user_profiles_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_profiles_postgres_all ON public.v2_user_profiles TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_user_profiles v2_user_profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_profiles_select_own ON public.v2_user_profiles FOR SELECT TO app_gateway, app_agent USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_profiles v2_user_profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_profiles_update_own ON public.v2_user_profiles FOR UPDATE TO app_gateway USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_user_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_user_skills v2_user_skills_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_skills_delete_own ON public.v2_user_skills FOR DELETE TO app_gateway USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_skills v2_user_skills_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_skills_insert_own ON public.v2_user_skills FOR INSERT TO app_gateway, app_agent WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_skills v2_user_skills_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_skills_postgres_all ON public.v2_user_skills TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_user_skills v2_user_skills_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_skills_select_own ON public.v2_user_skills FOR SELECT TO app_gateway, app_agent USING ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_user_skills v2_user_skills_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_user_skills_update_own ON public.v2_user_skills FOR UPDATE TO app_gateway, app_agent USING ((user_id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((user_id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.v2_users ENABLE ROW LEVEL SECURITY;

--
-- Name: v2_users v2_users_postgres_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_users_postgres_all ON public.v2_users TO postgres USING (true) WITH CHECK (true);


--
-- Name: v2_users v2_users_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_users_select_own ON public.v2_users FOR SELECT TO app_gateway, app_agent, app_webhooks USING ((id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: v2_users v2_users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY v2_users_update_own ON public.v2_users FOR UPDATE TO app_gateway, app_agent, app_webhooks USING ((id = ( SELECT public.current_app_user() AS current_app_user))) WITH CHECK ((id = ( SELECT public.current_app_user() AS current_app_user)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO app_gateway;
GRANT USAGE ON SCHEMA public TO app_agent;
GRANT USAGE ON SCHEMA public TO app_webhooks;


--
-- Name: FUNCTION claim_provider_key_revalidation_targets(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_provider_key_revalidation_targets(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_provider_key_revalidation_targets(p_limit integer) TO app_webhooks;


--
-- Name: FUNCTION current_app_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_app_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_app_user() TO app_gateway;
GRANT ALL ON FUNCTION public.current_app_user() TO app_agent;
GRANT ALL ON FUNCTION public.current_app_user() TO app_webhooks;


--
-- Name: FUNCTION delete_all_provider_keys(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_all_provider_keys() FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_all_provider_keys() TO app_webhooks;


--
-- Name: FUNCTION delete_provider_key(p_provider text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_provider_key(p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_provider_key(p_provider text) TO app_gateway;


--
-- Name: FUNCTION gateway_resolve_clerk_user(p_clerk_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.gateway_resolve_clerk_user(p_clerk_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gateway_resolve_clerk_user(p_clerk_id text) TO app_gateway;


--
-- Name: FUNCTION get_provider_key(p_provider text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_provider_key(p_provider text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_provider_key(p_provider text) TO app_agent;
GRANT ALL ON FUNCTION public.get_provider_key(p_provider text) TO app_webhooks;


--
-- Name: FUNCTION scrub_current_user_audit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.scrub_current_user_audit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.scrub_current_user_audit() TO app_webhooks;


--
-- Name: FUNCTION set_provider_key(p_provider text, p_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_provider_key(p_provider text, p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_provider_key(p_provider text, p_key text) TO app_gateway;


--
-- Name: FUNCTION sync_clerk_user(p_clerk_id text, p_email text, p_display_name text, p_avatar_url text, p_clerk_updated_at_ms bigint); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_clerk_user(p_clerk_id text, p_email text, p_display_name text, p_avatar_url text, p_clerk_updated_at_ms bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_clerk_user(p_clerk_id text, p_email text, p_display_name text, p_avatar_url text, p_clerk_updated_at_ms bigint) TO app_gateway;
GRANT ALL ON FUNCTION public.sync_clerk_user(p_clerk_id text, p_email text, p_display_name text, p_avatar_url text, p_clerk_updated_at_ms bigint) TO app_webhooks;


--
-- Name: FUNCTION uuidv7(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.uuidv7() FROM PUBLIC;
GRANT ALL ON FUNCTION public.uuidv7() TO app_gateway;
GRANT ALL ON FUNCTION public.uuidv7() TO app_agent;
GRANT ALL ON FUNCTION public.uuidv7() TO app_webhooks;


--
-- Name: FUNCTION v2_audit_entitlement_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.v2_audit_entitlement_change() FROM PUBLIC;


--
-- Name: FUNCTION v2_audit_integration_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.v2_audit_integration_change() FROM PUBLIC;


--
-- Name: FUNCTION v2_audit_provider_key_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.v2_audit_provider_key_change() FROM PUBLIC;


--
-- Name: FUNCTION v2_delete_provider_vault_secret(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.v2_delete_provider_vault_secret() FROM PUBLIC;


--
-- Name: FUNCTION v2_guard_terminal_agent_run_state(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.v2_guard_terminal_agent_run_state() FROM PUBLIC;


--
-- Name: FUNCTION v2_guard_user_deletion_refund_resolution(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.v2_guard_user_deletion_refund_resolution() FROM PUBLIC;


--
-- Name: FUNCTION v2_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.v2_touch_updated_at() FROM PUBLIC;


--
-- Name: FUNCTION webhooks_claim_ready_resource_deletion_jobs(p_lease_token uuid, p_limit integer, p_max_failures integer, p_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_claim_ready_resource_deletion_jobs(p_lease_token uuid, p_limit integer, p_max_failures integer, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_claim_ready_resource_deletion_jobs(p_lease_token uuid, p_limit integer, p_max_failures integer, p_now timestamp with time zone) TO app_webhooks;


--
-- Name: FUNCTION webhooks_claim_ready_user_deletion_jobs(p_lease_token uuid, p_limit integer, p_max_failures integer, p_now timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_claim_ready_user_deletion_jobs(p_lease_token uuid, p_limit integer, p_max_failures integer, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_claim_ready_user_deletion_jobs(p_lease_token uuid, p_limit integer, p_max_failures integer, p_now timestamp with time zone) TO app_webhooks;


--
-- Name: FUNCTION webhooks_discover_resource_deletion_jobs(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_discover_resource_deletion_jobs(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_discover_resource_deletion_jobs(p_limit integer) TO app_webhooks;


--
-- Name: FUNCTION webhooks_discover_user_deletion_jobs(p_before timestamp with time zone, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_discover_user_deletion_jobs(p_before timestamp with time zone, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_discover_user_deletion_jobs(p_before timestamp with time zone, p_limit integer) TO app_webhooks;


--
-- Name: FUNCTION webhooks_expire_composio_connection(p_connection_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_expire_composio_connection(p_connection_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_expire_composio_connection(p_connection_id text) TO app_webhooks;


--
-- Name: FUNCTION webhooks_finalize_current_user_deletion(p_deletion_fence text, p_clerk_identity_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_finalize_current_user_deletion(p_deletion_fence text, p_clerk_identity_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_finalize_current_user_deletion(p_deletion_fence text, p_clerk_identity_hash text) TO app_webhooks;


--
-- Name: FUNCTION webhooks_list_daily_activation_events(p_day date, p_cursor_event text, p_cursor_user_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_list_daily_activation_events(p_day date, p_cursor_event text, p_cursor_user_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_list_daily_activation_events(p_day date, p_cursor_event text, p_cursor_user_id uuid, p_limit integer) TO app_webhooks;


--
-- Name: FUNCTION webhooks_mark_clerk_user_deleted(p_clerk_id text, p_deleted_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_mark_clerk_user_deleted(p_clerk_id text, p_deleted_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_mark_clerk_user_deleted(p_clerk_id text, p_deleted_at timestamp with time zone) TO app_webhooks;


--
-- Name: FUNCTION webhooks_record_user_deletion_refund_evidence(p_job_id uuid, p_generation timestamp with time zone, p_continuation integer, p_lease_token uuid, p_cursor text, p_order_id text, p_amount integer, p_currency text, p_idempotency_key text, p_provider_refund_id text, p_provider_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_record_user_deletion_refund_evidence(p_job_id uuid, p_generation timestamp with time zone, p_continuation integer, p_lease_token uuid, p_cursor text, p_order_id text, p_amount integer, p_currency text, p_idempotency_key text, p_provider_refund_id text, p_provider_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_record_user_deletion_refund_evidence(p_job_id uuid, p_generation timestamp with time zone, p_continuation integer, p_lease_token uuid, p_cursor text, p_order_id text, p_amount integer, p_currency text, p_idempotency_key text, p_provider_refund_id text, p_provider_status text) TO app_webhooks;


--
-- Name: FUNCTION webhooks_reserve_user_deletion_refund_intent(p_job_id uuid, p_generation timestamp with time zone, p_continuation integer, p_lease_token uuid, p_cursor text, p_order_id text, p_amount integer, p_currency text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_reserve_user_deletion_refund_intent(p_job_id uuid, p_generation timestamp with time zone, p_continuation integer, p_lease_token uuid, p_cursor text, p_order_id text, p_amount integer, p_currency text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_reserve_user_deletion_refund_intent(p_job_id uuid, p_generation timestamp with time zone, p_continuation integer, p_lease_token uuid, p_cursor text, p_order_id text, p_amount integer, p_currency text) TO app_webhooks;


--
-- Name: FUNCTION webhooks_resolve_polar_customer(p_polar_customer_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.webhooks_resolve_polar_customer(p_polar_customer_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhooks_resolve_polar_customer(p_polar_customer_id text) TO app_webhooks;


--
-- Name: TABLE v2_agent_runs; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT ON TABLE public.v2_agent_runs TO app_agent;


--
-- Name: COLUMN v2_agent_runs.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.v2_agent_runs TO app_gateway;
GRANT SELECT(id) ON TABLE public.v2_agent_runs TO app_agent;
GRANT SELECT(id) ON TABLE public.v2_agent_runs TO app_webhooks;


--
-- Name: COLUMN v2_agent_runs.thread_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(thread_id) ON TABLE public.v2_agent_runs TO app_agent;
GRANT SELECT(thread_id) ON TABLE public.v2_agent_runs TO app_webhooks;


--
-- Name: COLUMN v2_agent_runs.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.v2_agent_runs TO app_gateway;
GRANT SELECT(user_id) ON TABLE public.v2_agent_runs TO app_agent;
GRANT SELECT(user_id) ON TABLE public.v2_agent_runs TO app_webhooks;


--
-- Name: COLUMN v2_agent_runs.status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(status) ON TABLE public.v2_agent_runs TO app_gateway;
GRANT SELECT(status),UPDATE(status) ON TABLE public.v2_agent_runs TO app_agent;
GRANT SELECT(status) ON TABLE public.v2_agent_runs TO app_webhooks;


--
-- Name: COLUMN v2_agent_runs.model_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(model_id),UPDATE(model_id) ON TABLE public.v2_agent_runs TO app_agent;


--
-- Name: COLUMN v2_agent_runs.started_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(started_at) ON TABLE public.v2_agent_runs TO app_gateway;
GRANT SELECT(started_at) ON TABLE public.v2_agent_runs TO app_webhooks;


--
-- Name: COLUMN v2_agent_runs.finished_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(finished_at) ON TABLE public.v2_agent_runs TO app_gateway;
GRANT UPDATE(finished_at) ON TABLE public.v2_agent_runs TO app_agent;
GRANT SELECT(finished_at) ON TABLE public.v2_agent_runs TO app_webhooks;


--
-- Name: COLUMN v2_agent_runs.idempotency_key_hash; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(idempotency_key_hash) ON TABLE public.v2_agent_runs TO app_agent;


--
-- Name: COLUMN v2_agent_runs.request_body_hash; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(request_body_hash) ON TABLE public.v2_agent_runs TO app_agent;


--
-- Name: COLUMN v2_agent_runs.skill_runtime_capabilities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(skill_runtime_capabilities),UPDATE(skill_runtime_capabilities) ON TABLE public.v2_agent_runs TO app_agent;


--
-- Name: TABLE v2_artifact_upload_intents; Type: ACL; Schema: public; Owner: -
--

GRANT DELETE ON TABLE public.v2_artifact_upload_intents TO app_agent;
GRANT DELETE ON TABLE public.v2_artifact_upload_intents TO app_webhooks;


--
-- Name: COLUMN v2_artifact_upload_intents.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id),INSERT(id) ON TABLE public.v2_artifact_upload_intents TO app_agent;
GRANT SELECT(id) ON TABLE public.v2_artifact_upload_intents TO app_webhooks;


--
-- Name: COLUMN v2_artifact_upload_intents.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id),INSERT(user_id) ON TABLE public.v2_artifact_upload_intents TO app_agent;
GRANT SELECT(user_id) ON TABLE public.v2_artifact_upload_intents TO app_webhooks;


--
-- Name: COLUMN v2_artifact_upload_intents.project_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(project_id),INSERT(project_id) ON TABLE public.v2_artifact_upload_intents TO app_agent;
GRANT SELECT(project_id) ON TABLE public.v2_artifact_upload_intents TO app_webhooks;


--
-- Name: COLUMN v2_artifact_upload_intents.agent_run_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(agent_run_id),INSERT(agent_run_id) ON TABLE public.v2_artifact_upload_intents TO app_agent;
GRANT SELECT(agent_run_id) ON TABLE public.v2_artifact_upload_intents TO app_webhooks;


--
-- Name: COLUMN v2_artifact_upload_intents.r2_key; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(r2_key),INSERT(r2_key) ON TABLE public.v2_artifact_upload_intents TO app_agent;
GRANT SELECT(r2_key) ON TABLE public.v2_artifact_upload_intents TO app_webhooks;


--
-- Name: COLUMN v2_artifact_upload_intents.cleanup_not_before; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(cleanup_not_before),INSERT(cleanup_not_before),UPDATE(cleanup_not_before) ON TABLE public.v2_artifact_upload_intents TO app_agent;
GRANT SELECT(cleanup_not_before) ON TABLE public.v2_artifact_upload_intents TO app_webhooks;


--
-- Name: COLUMN v2_artifact_upload_intents.quiesced_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(quiesced_at),UPDATE(quiesced_at) ON TABLE public.v2_artifact_upload_intents TO app_agent;
GRANT SELECT(quiesced_at) ON TABLE public.v2_artifact_upload_intents TO app_webhooks;


--
-- Name: TABLE v2_daily_maintenance_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,DELETE ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.day; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(day) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.scheduled_at; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(scheduled_at) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.phase; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(phase) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.activation_cursor_event; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(activation_cursor_event) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.activation_cursor_user_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(activation_cursor_user_id) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.continuation; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(continuation) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.release_version_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(release_version_id) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.lease_token; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(lease_token) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.lease_expires_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(lease_expires_at) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.failure_count; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(failure_count) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.next_attempt_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(next_attempt_at) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.last_error_code; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(last_error_code) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: COLUMN v2_daily_maintenance_jobs.completed_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(completed_at) ON TABLE public.v2_daily_maintenance_jobs TO app_webhooks;


--
-- Name: TABLE v2_entitlements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.v2_entitlements TO app_gateway;
GRANT SELECT,INSERT ON TABLE public.v2_entitlements TO app_webhooks;


--
-- Name: COLUMN v2_entitlements.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.v2_entitlements TO app_agent;


--
-- Name: COLUMN v2_entitlements.tier; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(tier) ON TABLE public.v2_entitlements TO app_agent;
GRANT UPDATE(tier) ON TABLE public.v2_entitlements TO app_webhooks;


--
-- Name: COLUMN v2_entitlements.polar_subscription_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(polar_subscription_id) ON TABLE public.v2_entitlements TO app_gateway;
GRANT UPDATE(polar_subscription_id) ON TABLE public.v2_entitlements TO app_webhooks;


--
-- Name: COLUMN v2_entitlements.subscription_status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(subscription_status) ON TABLE public.v2_entitlements TO app_gateway;
GRANT SELECT(subscription_status) ON TABLE public.v2_entitlements TO app_agent;
GRANT UPDATE(subscription_status) ON TABLE public.v2_entitlements TO app_webhooks;


--
-- Name: COLUMN v2_entitlements.current_period_start; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(current_period_start) ON TABLE public.v2_entitlements TO app_gateway;
GRANT SELECT(current_period_start) ON TABLE public.v2_entitlements TO app_agent;
GRANT UPDATE(current_period_start) ON TABLE public.v2_entitlements TO app_webhooks;


--
-- Name: COLUMN v2_entitlements.current_period_end; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(current_period_end) ON TABLE public.v2_entitlements TO app_gateway;
GRANT SELECT(current_period_end) ON TABLE public.v2_entitlements TO app_agent;
GRANT UPDATE(current_period_end) ON TABLE public.v2_entitlements TO app_webhooks;


--
-- Name: COLUMN v2_entitlements.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.v2_entitlements TO app_gateway;
GRANT SELECT(updated_at) ON TABLE public.v2_entitlements TO app_agent;
GRANT UPDATE(updated_at) ON TABLE public.v2_entitlements TO app_webhooks;


--
-- Name: COLUMN v2_entitlements.cancel_at_period_end; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(cancel_at_period_end) ON TABLE public.v2_entitlements TO app_gateway;
GRANT UPDATE(cancel_at_period_end) ON TABLE public.v2_entitlements TO app_webhooks;


--
-- Name: TABLE v2_generated_outputs; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT ON TABLE public.v2_generated_outputs TO app_agent;
GRANT DELETE ON TABLE public.v2_generated_outputs TO app_webhooks;


--
-- Name: COLUMN v2_generated_outputs.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.v2_generated_outputs TO app_agent;
GRANT SELECT(id) ON TABLE public.v2_generated_outputs TO app_webhooks;


--
-- Name: COLUMN v2_generated_outputs.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.v2_generated_outputs TO app_agent;
GRANT SELECT(user_id) ON TABLE public.v2_generated_outputs TO app_webhooks;


--
-- Name: COLUMN v2_generated_outputs.agent_run_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(agent_run_id) ON TABLE public.v2_generated_outputs TO app_webhooks;
GRANT SELECT(agent_run_id) ON TABLE public.v2_generated_outputs TO app_agent;


--
-- Name: COLUMN v2_generated_outputs.filename; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(filename) ON TABLE public.v2_generated_outputs TO app_agent;


--
-- Name: COLUMN v2_generated_outputs.r2_key; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(r2_key) ON TABLE public.v2_generated_outputs TO app_agent;
GRANT SELECT(r2_key) ON TABLE public.v2_generated_outputs TO app_webhooks;


--
-- Name: COLUMN v2_generated_outputs.mime_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(mime_type) ON TABLE public.v2_generated_outputs TO app_agent;


--
-- Name: TABLE v2_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v2_messages TO app_gateway;
GRANT SELECT,INSERT ON TABLE public.v2_messages TO app_agent;


--
-- Name: TABLE v2_projects; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.v2_projects TO app_gateway;
GRANT SELECT,INSERT ON TABLE public.v2_projects TO app_agent;
GRANT DELETE ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_projects.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_projects.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_projects.name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(name) ON TABLE public.v2_projects TO app_gateway;
GRANT SELECT(name) ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_projects.settings; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(settings) ON TABLE public.v2_projects TO app_gateway;


--
-- Name: COLUMN v2_projects.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_projects.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.v2_projects TO app_gateway;
GRANT SELECT(updated_at),UPDATE(updated_at) ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_projects.deleted_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(deleted_at) ON TABLE public.v2_projects TO app_gateway;
GRANT SELECT(deleted_at),UPDATE(deleted_at) ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_projects.over_quota; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(over_quota),UPDATE(over_quota) ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_projects.archive_after; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(archive_after),UPDATE(archive_after) ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_projects.workspace_slug; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(workspace_slug),UPDATE(workspace_slug) ON TABLE public.v2_projects TO app_webhooks;


--
-- Name: COLUMN v2_provider_keys.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.v2_provider_keys TO app_gateway;
GRANT SELECT(user_id) ON TABLE public.v2_provider_keys TO app_webhooks;


--
-- Name: COLUMN v2_provider_keys.provider; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(provider) ON TABLE public.v2_provider_keys TO app_gateway;
GRANT SELECT(provider) ON TABLE public.v2_provider_keys TO app_webhooks;


--
-- Name: COLUMN v2_provider_keys.fingerprint; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(fingerprint) ON TABLE public.v2_provider_keys TO app_webhooks;


--
-- Name: COLUMN v2_provider_keys.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.v2_provider_keys TO app_gateway;
GRANT SELECT(created_at) ON TABLE public.v2_provider_keys TO app_webhooks;


--
-- Name: COLUMN v2_provider_keys.disabled_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(disabled_at),UPDATE(disabled_at) ON TABLE public.v2_provider_keys TO app_gateway;
GRANT SELECT(disabled_at),UPDATE(disabled_at) ON TABLE public.v2_provider_keys TO app_webhooks;


--
-- Name: COLUMN v2_provider_keys.disabled_reason; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(disabled_reason),UPDATE(disabled_reason) ON TABLE public.v2_provider_keys TO app_gateway;
GRANT SELECT(disabled_reason),UPDATE(disabled_reason) ON TABLE public.v2_provider_keys TO app_webhooks;


--
-- Name: COLUMN v2_provider_keys.last_revalidated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(last_revalidated_at) ON TABLE public.v2_provider_keys TO app_webhooks;


--
-- Name: COLUMN v2_provider_keys.revalidation_claimed_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(revalidation_claimed_at),UPDATE(revalidation_claimed_at) ON TABLE public.v2_provider_keys TO app_webhooks;


--
-- Name: COLUMN v2_provider_keys.revalidation_lease_token; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(revalidation_lease_token),UPDATE(revalidation_lease_token) ON TABLE public.v2_provider_keys TO app_webhooks;


--
-- Name: TABLE v2_resource_deletion_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_resource_deletion_jobs.phase; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(phase) ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_resource_deletion_jobs.cursor; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(cursor) ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_resource_deletion_jobs.continuation; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(continuation) ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_resource_deletion_jobs.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_resource_deletion_jobs.lease_token; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(lease_token) ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_resource_deletion_jobs.lease_expires_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(lease_expires_at) ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_resource_deletion_jobs.failure_count; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(failure_count) ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_resource_deletion_jobs.next_attempt_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(next_attempt_at) ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_resource_deletion_jobs.last_error_code; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(last_error_code) ON TABLE public.v2_resource_deletion_jobs TO app_webhooks;


--
-- Name: TABLE v2_threads; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.v2_threads TO app_gateway;
GRANT SELECT ON TABLE public.v2_threads TO app_agent;
GRANT DELETE ON TABLE public.v2_threads TO app_webhooks;


--
-- Name: COLUMN v2_threads.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.v2_threads TO app_webhooks;


--
-- Name: COLUMN v2_threads.project_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(project_id) ON TABLE public.v2_threads TO app_agent;
GRANT SELECT(project_id) ON TABLE public.v2_threads TO app_webhooks;


--
-- Name: COLUMN v2_threads.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.v2_threads TO app_webhooks;


--
-- Name: COLUMN v2_threads.title; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(title) ON TABLE public.v2_threads TO app_gateway;


--
-- Name: COLUMN v2_threads.active_run_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(active_run_id) ON TABLE public.v2_threads TO app_agent;
GRANT SELECT(active_run_id),UPDATE(active_run_id) ON TABLE public.v2_threads TO app_webhooks;


--
-- Name: COLUMN v2_threads.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.v2_threads TO app_gateway;
GRANT UPDATE(updated_at) ON TABLE public.v2_threads TO app_agent;
GRANT UPDATE(updated_at) ON TABLE public.v2_threads TO app_webhooks;


--
-- Name: COLUMN v2_threads.deleted_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(deleted_at) ON TABLE public.v2_threads TO app_gateway;
GRANT SELECT(deleted_at),UPDATE(deleted_at) ON TABLE public.v2_threads TO app_webhooks;


--
-- Name: COLUMN v2_threads.launch_intent; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(launch_intent) ON TABLE public.v2_threads TO app_agent;


--
-- Name: COLUMN v2_threads.latest_model_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(latest_model_id) ON TABLE public.v2_threads TO app_gateway;
GRANT UPDATE(latest_model_id) ON TABLE public.v2_threads TO app_agent;


--
-- Name: TABLE v2_user_deletion_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_user_deletion_jobs.phase; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(phase) ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_user_deletion_jobs.cursor; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(cursor) ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_user_deletion_jobs.continuation; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(continuation) ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_user_deletion_jobs.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_user_deletion_jobs.lease_token; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(lease_token) ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_user_deletion_jobs.lease_expires_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(lease_expires_at) ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_user_deletion_jobs.failure_count; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(failure_count) ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_user_deletion_jobs.next_attempt_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(next_attempt_at) ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: COLUMN v2_user_deletion_jobs.last_error_code; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(last_error_code) ON TABLE public.v2_user_deletion_jobs TO app_webhooks;


--
-- Name: TABLE v2_user_deletion_refund_intents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v2_user_deletion_refund_intents TO app_webhooks;


--
-- Name: TABLE v2_user_integrations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE public.v2_user_integrations TO app_gateway;


--
-- Name: COLUMN v2_user_integrations.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.v2_user_integrations TO app_agent;
GRANT SELECT(user_id) ON TABLE public.v2_user_integrations TO app_webhooks;


--
-- Name: COLUMN v2_user_integrations.integration; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(integration) ON TABLE public.v2_user_integrations TO app_agent;
GRANT SELECT(integration) ON TABLE public.v2_user_integrations TO app_webhooks;


--
-- Name: COLUMN v2_user_integrations.composio_connection_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(composio_connection_id) ON TABLE public.v2_user_integrations TO app_agent;
GRANT SELECT(composio_connection_id) ON TABLE public.v2_user_integrations TO app_webhooks;


--
-- Name: COLUMN v2_user_integrations.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.v2_user_integrations TO app_gateway;
GRANT SELECT(status) ON TABLE public.v2_user_integrations TO app_agent;
GRANT SELECT(status) ON TABLE public.v2_user_integrations TO app_webhooks;


--
-- Name: COLUMN v2_user_integrations.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.v2_user_integrations TO app_agent;
GRANT SELECT(updated_at) ON TABLE public.v2_user_integrations TO app_webhooks;


--
-- Name: COLUMN v2_user_integrations.is_default; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(is_default) ON TABLE public.v2_user_integrations TO app_gateway;
GRANT SELECT(is_default) ON TABLE public.v2_user_integrations TO app_agent;
GRANT SELECT(is_default) ON TABLE public.v2_user_integrations TO app_webhooks;


--
-- Name: TABLE v2_user_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.v2_user_profiles TO app_gateway;


--
-- Name: COLUMN v2_user_profiles.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(user_id) ON TABLE public.v2_user_profiles TO app_agent;


--
-- Name: COLUMN v2_user_profiles.agent_display_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(agent_display_name) ON TABLE public.v2_user_profiles TO app_gateway;
GRANT SELECT(agent_display_name) ON TABLE public.v2_user_profiles TO app_agent;


--
-- Name: COLUMN v2_user_profiles.global_memory; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(global_memory) ON TABLE public.v2_user_profiles TO app_gateway;
GRANT SELECT(global_memory) ON TABLE public.v2_user_profiles TO app_agent;


--
-- Name: COLUMN v2_user_profiles.disabled_models; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(disabled_models) ON TABLE public.v2_user_profiles TO app_gateway;
GRANT SELECT(disabled_models) ON TABLE public.v2_user_profiles TO app_agent;


--
-- Name: COLUMN v2_user_profiles.onboarding_completed_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(onboarding_completed_at) ON TABLE public.v2_user_profiles TO app_gateway;


--
-- Name: COLUMN v2_user_profiles.onboarding_state; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(onboarding_state) ON TABLE public.v2_user_profiles TO app_gateway;


--
-- Name: TABLE v2_user_skills; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE ON TABLE public.v2_user_skills TO app_gateway;
GRANT SELECT,INSERT ON TABLE public.v2_user_skills TO app_agent;


--
-- Name: COLUMN v2_user_skills.description; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(description) ON TABLE public.v2_user_skills TO app_gateway;
GRANT UPDATE(description) ON TABLE public.v2_user_skills TO app_agent;


--
-- Name: COLUMN v2_user_skills.category; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(category) ON TABLE public.v2_user_skills TO app_gateway;
GRANT UPDATE(category) ON TABLE public.v2_user_skills TO app_agent;


--
-- Name: COLUMN v2_user_skills.tags; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(tags) ON TABLE public.v2_user_skills TO app_gateway;
GRANT UPDATE(tags) ON TABLE public.v2_user_skills TO app_agent;


--
-- Name: COLUMN v2_user_skills.body; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(body) ON TABLE public.v2_user_skills TO app_gateway;
GRANT UPDATE(body) ON TABLE public.v2_user_skills TO app_agent;


--
-- Name: COLUMN v2_user_skills.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.v2_user_skills TO app_gateway;
GRANT UPDATE(updated_at) ON TABLE public.v2_user_skills TO app_agent;


--
-- Name: COLUMN v2_users.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.v2_users TO app_gateway;
GRANT SELECT(id) ON TABLE public.v2_users TO app_agent;
GRANT SELECT(id) ON TABLE public.v2_users TO app_webhooks;


--
-- Name: COLUMN v2_users.clerk_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(clerk_id) ON TABLE public.v2_users TO app_gateway;
GRANT SELECT(clerk_id) ON TABLE public.v2_users TO app_webhooks;


--
-- Name: COLUMN v2_users.email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(email) ON TABLE public.v2_users TO app_gateway;
GRANT SELECT(email) ON TABLE public.v2_users TO app_webhooks;


--
-- Name: COLUMN v2_users.polar_customer_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(polar_customer_id) ON TABLE public.v2_users TO app_gateway;
GRANT SELECT(polar_customer_id),UPDATE(polar_customer_id) ON TABLE public.v2_users TO app_webhooks;


--
-- Name: COLUMN v2_users.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.v2_users TO app_webhooks;


--
-- Name: COLUMN v2_users.deleted_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(deleted_at) ON TABLE public.v2_users TO app_gateway;
GRANT SELECT(deleted_at) ON TABLE public.v2_users TO app_agent;
GRANT SELECT(deleted_at),UPDATE(deleted_at) ON TABLE public.v2_users TO app_webhooks;


--
-- Name: COLUMN v2_users.display_name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(display_name),UPDATE(display_name) ON TABLE public.v2_users TO app_gateway;
GRANT SELECT(display_name) ON TABLE public.v2_users TO app_webhooks;


--
-- Name: COLUMN v2_users.avatar_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(avatar_url) ON TABLE public.v2_users TO app_gateway;
GRANT SELECT(avatar_url) ON TABLE public.v2_users TO app_webhooks;


--
-- Name: COLUMN v2_users.deletion_fence; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(deletion_fence) ON TABLE public.v2_users TO app_gateway;
GRANT SELECT(deletion_fence) ON TABLE public.v2_users TO app_agent;
GRANT SELECT(deletion_fence),UPDATE(deletion_fence) ON TABLE public.v2_users TO app_webhooks;


--
-- Name: COLUMN v2_users.first_artifact_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(first_artifact_at),UPDATE(first_artifact_at) ON TABLE public.v2_users TO app_agent;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

-- The pg_dump of production also recreated supabase_admin's default ACLs for
-- sequences, functions, and tables at this point. Those statements are removed:
-- they are Supabase-managed platform state that already exists on every
-- project, they only affect supabase_admin-created objects (this schema
-- creates none), and the migration role `postgres` is denied ALTER DEFAULT
-- PRIVILEGES FOR ROLE supabase_admin (SQLSTATE 42501) on every Supabase
-- project, old or new.


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--
