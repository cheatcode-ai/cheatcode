-- Every retained artifact must belong to the run that created it. Historical
-- rows with no run are R2-backed and must be removed object-first by the
-- deployed retention workflow; this migration never deletes them silently.
do $output_preflight$
declare
  ownerless_count bigint;
begin
  select count(*)
    into ownerless_count
    from public.v2_generated_outputs
   where agent_run_id is null;
  if ownerless_count > 0 then
    raise exception
      'generated-output contraction refused: % rows have no agent_run_id; delete their R2 objects before their database rows and retry',
      ownerless_count;
  end if;
end
$output_preflight$;

alter table public.v2_generated_outputs
  drop constraint v2_generated_outputs_project_user_fk,
  drop constraint v2_generated_outputs_agent_run_user_fk,
  drop constraint v2_generated_outputs_size_check,
  drop constraint v2_generated_outputs_sha256_check,
  drop constraint v2_generated_outputs_kind_check,
  drop constraint v2_generated_outputs_metadata_check;

drop index if exists public.v2_generated_outputs_project_created_idx;
drop index if exists public.v2_generated_outputs_agent_run_idx;
drop index if exists public.v2_generated_outputs_expiry_idx;

alter table public.v2_generated_outputs
  alter column agent_run_id set not null,
  drop column project_id,
  drop column kind,
  drop column size_bytes,
  drop column sha256,
  drop column metadata,
  add constraint v2_generated_outputs_agent_run_user_fk
    foreign key (agent_run_id, user_id)
    references public.v2_agent_runs (id, user_id)
    on delete restrict;

create index v2_generated_outputs_agent_run_idx
  on public.v2_generated_outputs (agent_run_id);

create index v2_generated_outputs_expiry_idx
  on public.v2_generated_outputs (expires_at, id);
