create index if not exists v2_projects_user_created_idx on v2_projects (user_id, created_at desc) where deleted_at is null;
create index if not exists v2_threads_user_project_created_idx on v2_threads (user_id, project_id, created_at desc) where deleted_at is null;
create index if not exists v2_messages_thread_created_idx on v2_messages (thread_id, created_at);
create index if not exists v2_agent_runs_thread_started_idx on v2_agent_runs (thread_id, started_at desc);
create unique index if not exists v2_provider_keys_user_provider_idx on v2_provider_keys (user_id, provider) where deleted_at is null;
create index if not exists v2_generated_outputs_user_created_idx on v2_generated_outputs (user_id, created_at desc);
create index if not exists v2_usage_events_user_created_idx on v2_usage_events (user_id, created_at desc);
create index if not exists v2_audit_log_user_created_idx on v2_audit_log (user_id, created_at desc);
