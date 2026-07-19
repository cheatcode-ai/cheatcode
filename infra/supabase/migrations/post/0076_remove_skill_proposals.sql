update public.v2_messages as message
set parts = (
  select coalesce(jsonb_agg(part.value order by part.ordinality), '[]'::jsonb)
  from jsonb_array_elements(message.parts) with ordinality as part(value, ordinality)
  where part.value ->> 'type' <> 'data-skill-proposed'
)
where exists (
  select 1
  from jsonb_array_elements(message.parts) as part(value)
  where part.value ->> 'type' = 'data-skill-proposed'
);
