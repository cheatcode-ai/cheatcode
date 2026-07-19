import type { RuntimeDatabaseRole } from "./supabase-target-contracts";

interface FunctionContract {
  arguments: string;
  executeRoles: readonly RuntimeDatabaseRole[];
  language?: string;
  name: string;
  requiresLockedSearchPath?: boolean;
  result: string;
  securityDefiner: boolean;
  sourceHash?: string;
}

export const FUNCTION_CONTRACTS: readonly FunctionContract[] = [
  {
    arguments: "",
    executeRoles: ["app_gateway", "app_agent", "app_webhooks"],
    name: "uuidv7",
    result: "uuid",
    securityDefiner: true,
  },
  {
    arguments: "",
    executeRoles: [],
    language: "plpgsql",
    name: "ensure_v2_audit_partitions",
    requiresLockedSearchPath: true,
    result: "integer",
    securityDefiner: false,
    sourceHash: "df5c340f63b3e33a3b4ef911d923e4e3666f9c6cde67c3783c8140e8fdc18652",
  },
  {
    arguments: "",
    executeRoles: ["app_gateway", "app_agent", "app_webhooks"],
    language: "plpgsql",
    name: "current_app_user",
    result: "uuid",
    securityDefiner: true,
    sourceHash: "75671e596c9af98856f79447c55713fe7ffa7b54aae59518c697c00cc4e4ee27",
  },
  {
    arguments: "text",
    executeRoles: ["app_gateway"],
    language: "sql",
    name: "gateway_resolve_clerk_user",
    result: "uuid",
    securityDefiner: true,
    sourceHash: "3e58bb20df05bab445f03578db4e6452d7cf5f479f62b9ef6456ba7f97c9624d",
  },
  {
    arguments: "text, text, text, text, bigint",
    executeRoles: ["app_gateway", "app_webhooks"],
    language: "plpgsql",
    name: "sync_clerk_user",
    result:
      "TABLE(sync_state text, user_id uuid, email text, display_name text, avatar_url text, polar_customer_id text, clerk_updated_at_ms bigint, email_changed boolean, profile_changed boolean)",
    securityDefiner: true,
    sourceHash: "1b3c7e734de67939da42c05a84c2532ab82df1f273dd4b1f239687825036b86d",
  },
  {
    arguments: "text, timestamp with time zone",
    executeRoles: ["app_webhooks"],
    language: "plpgsql",
    name: "webhooks_mark_clerk_user_deleted",
    result: "uuid",
    securityDefiner: true,
    sourceHash: "13b259eb1e02a515d043ede5c51757a475de8afa5da2aace421d09389297ed79",
  },
  {
    arguments: "text",
    executeRoles: ["app_webhooks"],
    language: "sql",
    name: "webhooks_resolve_polar_customer",
    result: "TABLE(user_id uuid, email text, polar_customer_id text)",
    securityDefiner: true,
    sourceHash: "f8dbfe82ca5778acc23ba3761b7a6b5234c632aaedf6d64a40aad8d39572a401",
  },
  {
    arguments: "text",
    executeRoles: ["app_webhooks"],
    language: "plpgsql",
    name: "webhooks_expire_composio_connection",
    result: "boolean",
    securityDefiner: true,
    sourceHash: "4c7f0d5d7ad7139dc5b3873a126ade5591e836d867be1185a75ec76663e08769",
  },
  {
    arguments: "timestamp with time zone, integer",
    executeRoles: ["app_webhooks"],
    language: "plpgsql",
    name: "webhooks_discover_user_deletion_jobs",
    result: "integer",
    securityDefiner: true,
    sourceHash: "8c7535bafd93df12e30012028ad60c9ebb7136df612c6304102259ecfba6af97",
  },
  {
    arguments: "uuid, integer, integer, timestamp with time zone",
    executeRoles: ["app_webhooks"],
    language: "plpgsql",
    name: "webhooks_claim_ready_user_deletion_jobs",
    result: "TABLE(disposition text, job_id uuid, user_id uuid, continuation integer)",
    securityDefiner: true,
    sourceHash: "6fdba54535941191d3f44aaf6e45348c256d88b7ee446637744d188bcc62b78d",
  },
  {
    arguments: "date, text, uuid, integer",
    executeRoles: ["app_webhooks"],
    language: "sql",
    name: "webhooks_list_daily_activation_events",
    result:
      "TABLE(event_order integer, event_name text, user_id uuid, cohort_week text, cohort_month text)",
    securityDefiner: true,
    sourceHash: "3922baabea4100172936a3731c9a1eef055dd515e3c36f5cd594f742ebde1214",
  },
  {
    arguments: "integer",
    executeRoles: ["app_webhooks"],
    language: "plpgsql",
    name: "webhooks_discover_resource_deletion_jobs",
    result: "TABLE(projects integer, threads integer)",
    securityDefiner: true,
    sourceHash: "f126efd2fd47bbf927c4404f64d81a1ba014505761936f1a5bd95fd838160322",
  },
  {
    arguments: "uuid, integer, integer, timestamp with time zone",
    executeRoles: ["app_webhooks"],
    language: "plpgsql",
    name: "webhooks_claim_ready_resource_deletion_jobs",
    result: "TABLE(disposition text, job_id uuid, user_id uuid, continuation integer)",
    securityDefiner: true,
    sourceHash: "856fe2456674f339bb3795e7c9c67bc9d9254fd798b4ab7f7605f88e965438b1",
  },
  {
    arguments: "uuid, timestamp with time zone, integer, uuid, text, text, integer, text",
    executeRoles: ["app_webhooks"],
    language: "plpgsql",
    name: "webhooks_reserve_user_deletion_refund_intent",
    result:
      "TABLE(job_id uuid, user_id uuid, generation timestamp with time zone, order_id text, amount integer, currency text, idempotency_key text, provider_refund_id text, provider_status text, created_at timestamp with time zone, reconciled_at timestamp with time zone)",
    securityDefiner: true,
    sourceHash: "7cd64b02c9bfae268d31b9a032fe31ee7721ff3efc101f869c303f2e0d31499a",
  },
  {
    arguments:
      "uuid, timestamp with time zone, integer, uuid, text, text, integer, text, text, text, text",
    executeRoles: ["app_webhooks"],
    language: "plpgsql",
    name: "webhooks_record_user_deletion_refund_evidence",
    result:
      "TABLE(job_id uuid, user_id uuid, generation timestamp with time zone, order_id text, amount integer, currency text, idempotency_key text, provider_refund_id text, provider_status text, created_at timestamp with time zone, reconciled_at timestamp with time zone)",
    securityDefiner: true,
    sourceHash: "a0904f439a1d276745ff189dae5dd37355952b77af90db54f0eaf5125300ffbe",
  },
  {
    arguments: "text, text",
    executeRoles: ["app_webhooks"],
    language: "plpgsql",
    name: "webhooks_finalize_current_user_deletion",
    result: "boolean",
    securityDefiner: true,
    sourceHash: "2b12706bd1263e4859969fcf7ffeb1a2bb06a07a9a2b83c6dbe9af9cded4898d",
  },
  {
    arguments: "text, text",
    executeRoles: ["app_gateway"],
    name: "set_provider_key",
    result: "void",
    securityDefiner: true,
  },
  {
    arguments: "text",
    executeRoles: ["app_agent", "app_webhooks"],
    name: "get_provider_key",
    result: "text",
    securityDefiner: true,
  },
  {
    arguments: "text",
    executeRoles: ["app_gateway"],
    name: "delete_provider_key",
    result: "void",
    securityDefiner: true,
  },
  {
    arguments: "",
    executeRoles: ["app_webhooks"],
    name: "delete_all_provider_keys",
    result: "integer",
    securityDefiner: true,
  },
  {
    arguments: "integer",
    executeRoles: ["app_webhooks"],
    name: "claim_provider_key_revalidation_targets",
    result: "TABLE(user_id uuid, provider text, fingerprint text, lease_token uuid)",
    securityDefiner: true,
  },
  {
    arguments: "",
    executeRoles: ["app_webhooks"],
    name: "scrub_current_user_audit",
    result: "bigint",
    securityDefiner: true,
  },
  {
    arguments: "",
    executeRoles: [],
    language: "plpgsql",
    name: "v2_guard_user_deletion_refund_resolution",
    requiresLockedSearchPath: true,
    result: "trigger",
    securityDefiner: false,
    sourceHash: "be312e047916d60bb6a1b952d6064aec98d6802d294b05b05d3baf17ec930e0f",
  },
  {
    arguments: "",
    executeRoles: [],
    language: "plpgsql",
    name: "v2_guard_terminal_agent_run_state",
    requiresLockedSearchPath: true,
    result: "trigger",
    securityDefiner: false,
    sourceHash: "42c885c57c9222b4b6cf2803dd5114935860f440fa2c975c3b08df33e6adbe66",
  },
  {
    arguments: "",
    executeRoles: [],
    name: "v2_delete_provider_vault_secret",
    result: "trigger",
    securityDefiner: true,
  },
  {
    arguments: "",
    executeRoles: [],
    name: "v2_audit_provider_key_change",
    result: "trigger",
    securityDefiner: true,
  },
  {
    arguments: "",
    executeRoles: [],
    name: "v2_audit_entitlement_change",
    result: "trigger",
    securityDefiner: true,
  },
  {
    arguments: "",
    executeRoles: [],
    name: "v2_audit_integration_change",
    result: "trigger",
    securityDefiner: true,
  },
  {
    arguments: "",
    executeRoles: [],
    name: "v2_touch_updated_at",
    result: "trigger",
    securityDefiner: false,
  },
] as const;

export function functionIdentity(contract: Pick<FunctionContract, "arguments" | "name">): string {
  return `${contract.name}(${contract.arguments})`;
}
