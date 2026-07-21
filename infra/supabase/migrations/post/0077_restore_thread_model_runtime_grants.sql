-- 0069 rebuilds the runtime privilege surface after earlier expansions. Model
-- attribution arrived later, so restore only the two V2 update grants its
-- writers require after that rebuild.
grant update (latest_model_id) on table public.v2_threads to app_gateway, app_agent;
