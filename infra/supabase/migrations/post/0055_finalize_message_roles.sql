-- V2 persists only user prompts and assistant transcript segments. Remove rows
-- from superseded experimental roles before making that exact contract valid.
lock table public.v2_messages in share row exclusive mode;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.v2_messages'::regclass
       and conname = 'v2_messages_role_check'
  ) then
    raise exception 'message-role contraction refused: role constraint is missing';
  end if;
end
$$;

delete from public.v2_messages
 where role not in ('assistant', 'user');

alter table public.v2_messages
  validate constraint v2_messages_role_check;
