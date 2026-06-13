create or replace function public.uuidv7()
returns uuid
language sql
volatile
security definer
set search_path = ''
as $function$
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
$function$;

grant execute on function public.uuidv7() to app_worker;
