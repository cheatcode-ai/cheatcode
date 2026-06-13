drop trigger if exists trg_v2_entitlements_updated on v2_entitlements;

create trigger trg_v2_entitlements_updated before update on v2_entitlements
  for each row execute function public.v2_touch_updated_at();
