create or replace function public.v2_touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create trigger trg_v2_users_updated before update on v2_users
  for each row execute function public.v2_touch_updated_at();
create trigger trg_v2_projects_updated before update on v2_projects
  for each row execute function public.v2_touch_updated_at();
create trigger trg_v2_threads_updated before update on v2_threads
  for each row execute function public.v2_touch_updated_at();
create trigger trg_v2_user_integrations_updated before update on v2_user_integrations
  for each row execute function public.v2_touch_updated_at();

create or replace function v2_audit_provider_key_change() returns trigger as $$
begin
  insert into v2_audit_log (user_id, action, resource_type, resource_id, metadata)
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
end $$ language plpgsql;

create trigger trg_v2_audit_provider_keys
  after insert or update or delete on v2_provider_keys
  for each row execute function v2_audit_provider_key_change();
