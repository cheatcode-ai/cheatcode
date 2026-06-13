-- Post-migration for v2_user_profiles (Drizzle migration 0002 creates the table).
-- Grants the app_worker role (Workers never use service_role) and wires the updated_at trigger.
-- The blanket revoke in 0014_v2_grants.sql already ran, so this grant is additive.

grant select, insert, update, delete on table v2_user_profiles to app_worker;

drop trigger if exists trg_v2_user_profiles_updated on v2_user_profiles;
create trigger trg_v2_user_profiles_updated
  before update on v2_user_profiles
  for each row execute function public.v2_touch_updated_at();
