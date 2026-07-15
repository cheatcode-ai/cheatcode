-- The keyset-ready replacement is created expand-only by Drizzle migration 0023.
-- Remove the narrower superseded index only after the matching application is live.
drop index if exists public.v2_threads_user_recent_idx;
