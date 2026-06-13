alter table if exists v2_entitlements
  add column if not exists cancel_at_period_end boolean not null default false;
