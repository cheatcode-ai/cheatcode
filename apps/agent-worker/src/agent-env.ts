import type { CloudflareVersionMetadata, WorkerSecret } from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";
import type { AgentRun } from "./durable-objects/agent-run";
import type { ProjectSandbox } from "./durable-objects/project-sandbox";

export interface AgentEnv extends AnalyticsBindings {
  AGENT_RUN: DurableObjectNamespace<AgentRun>;
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string;
  COMPOSIO_API_KEY?: WorkerSecret;
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_ORG_ID?: string;
  DAYTONA_PREVIEW_HOST_SUFFIXES?: string;
  DAYTONA_TARGET: string;
  HYPERDRIVE: Hyperdrive;
  INTERNAL_MAINTENANCE_SECRET?: WorkerSecret;
  OUTPUT_DOWNLOAD_BASE_URL?: string;
  OUTPUT_DOWNLOAD_SIGNING_SECRET: WorkerSecret;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
  PREVIEW_HOSTNAME: string;
  PROJECT_SANDBOX: DurableObjectNamespace<ProjectSandbox>;
  QUOTA_TRACKER: DurableObjectNamespace;
  R2_AUDIT: R2Bucket;
  R2_OUTPUTS: R2Bucket;
  R2_OUTPUTS_BUCKET_NAME?: string;
  SANDBOX_STATE?: KVNamespace;
}
