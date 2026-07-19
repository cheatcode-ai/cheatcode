-- Artifact download capabilities are minted on demand. Persisted message parts retain only
-- durable output identity and presentation metadata.

do $$
declare
  invalid_count bigint;
begin
  select count(*)
    into invalid_count
    from public.v2_messages
   where jsonb_typeof(parts) is distinct from 'array';

  if invalid_count <> 0 then
    raise exception
      'artifact download URL contraction refused: % message parts payloads are not arrays',
      invalid_count;
  end if;

  select count(*)
    into invalid_count
    from public.v2_messages as message
    cross join lateral jsonb_array_elements(message.parts) as part(value)
   where jsonb_typeof(part.value) is distinct from 'object';

  if invalid_count <> 0 then
    raise exception
      'artifact download URL contraction refused: % message parts are not objects',
      invalid_count;
  end if;

  select count(*)
    into invalid_count
    from public.v2_messages as message
    cross join lateral jsonb_array_elements(message.parts) as part(value)
   where part.value ->> 'type' = 'data-artifact'
     and jsonb_typeof(part.value -> 'data') is distinct from 'object';

  if invalid_count <> 0 then
    raise exception
      'artifact download URL contraction refused: % artifact data payloads are not objects',
      invalid_count;
  end if;
end
$$;

with contracted_messages as (
  select
    message.id,
    jsonb_agg(
      case
        when part.value ->> 'type' = 'data-artifact'
          then part.value #- '{data,downloadUrl}'
        else part.value
      end
      order by part.ordinality
    ) as parts
  from public.v2_messages as message
  cross join lateral jsonb_array_elements(message.parts) with ordinality as part(value, ordinality)
  group by message.id
)
update public.v2_messages as message
   set parts = contracted.parts
  from contracted_messages as contracted
 where message.id = contracted.id
   and message.parts is distinct from contracted.parts;

do $$
begin
  if exists (
    select 1
      from public.v2_messages as message
      cross join lateral jsonb_array_elements(message.parts) as part(value)
     where part.value ->> 'type' = 'data-artifact'
       and (part.value -> 'data') ? 'downloadUrl'
  ) then
    raise exception 'artifact download URL contraction failed: persisted URLs remain';
  end if;
end
$$;
