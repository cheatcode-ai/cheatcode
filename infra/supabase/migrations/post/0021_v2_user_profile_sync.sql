alter table public.v2_users
  add column if not exists display_name text,
  add column if not exists avatar_url text;
