create table if not exists v2_audit_log (
  id uuid not null default public.uuidv7(),
  user_id uuid,
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

do $$
declare
  partition_start date;
  partition_end date;
  partition_name text;
begin
  for month_offset in -1..24 loop
    partition_start := (date_trunc('month', now())::date + (month_offset || ' months')::interval)::date;
    partition_end := (partition_start + interval '1 month')::date;
    partition_name := 'v2_audit_log_' || to_char(partition_start, 'YYYY_MM');

    execute format(
      'create table if not exists public.%I partition of public.v2_audit_log for values from (%L) to (%L)',
      partition_name,
      partition_start::timestamptz,
      partition_end::timestamptz
    );
  end loop;
end
$$;
