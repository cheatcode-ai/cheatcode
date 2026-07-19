-- Mastra runs with the in-memory storage boundary in the current Worker. The
-- old Postgres store is therefore dead state, including five abandoned thread
-- rows. Enumerate every audited relation and keep RESTRICT throughout.
drop table if exists mastra.cheatcode_memory_messages restrict;
drop table if exists mastra.mastra_agent_versions restrict;
drop table if exists mastra.mastra_agents restrict;
drop table if exists mastra.mastra_ai_spans restrict;
drop table if exists mastra.mastra_background_tasks restrict;
drop table if exists mastra.mastra_channel_config restrict;
drop table if exists mastra.mastra_channel_installations restrict;
drop table if exists mastra.mastra_dataset_items restrict;
drop table if exists mastra.mastra_dataset_versions restrict;
drop table if exists mastra.mastra_datasets restrict;
drop table if exists mastra.mastra_experiment_results restrict;
drop table if exists mastra.mastra_experiments restrict;
drop table if exists mastra.mastra_favorites restrict;
drop table if exists mastra.mastra_mcp_client_versions restrict;
drop table if exists mastra.mastra_mcp_clients restrict;
drop table if exists mastra.mastra_mcp_server_versions restrict;
drop table if exists mastra.mastra_mcp_servers restrict;
drop table if exists mastra.mastra_messages restrict;
drop table if exists mastra.mastra_observational_memory restrict;
drop table if exists mastra.mastra_prompt_block_versions restrict;
drop table if exists mastra.mastra_prompt_blocks restrict;
drop table if exists mastra.mastra_resources restrict;
drop table if exists mastra.mastra_schedule_triggers restrict;
drop table if exists mastra.mastra_schedules restrict;
drop table if exists mastra.mastra_scorer_definition_versions restrict;
drop table if exists mastra.mastra_scorer_definitions restrict;
drop table if exists mastra.mastra_scorers restrict;
drop table if exists mastra.mastra_skill_blobs restrict;
drop table if exists mastra.mastra_skill_versions restrict;
drop table if exists mastra.mastra_skills restrict;
drop table if exists mastra.mastra_threads restrict;
drop table if exists mastra.mastra_workflow_snapshot restrict;
drop table if exists mastra.mastra_workspace_versions restrict;
drop table if exists mastra.mastra_workspaces restrict;

drop sequence if exists mastra.cheatcode_memory_messages_id_seq restrict;
drop function if exists mastra.trigger_set_timestamps() restrict;
drop schema if exists mastra restrict;
