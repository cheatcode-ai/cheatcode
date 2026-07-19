import type { CloudflareVersionMetadata, WorkerSecret } from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";
import type { AgentRun } from "./durable-objects/agent-run";
import type { AgentRunWorkflowPayload } from "./durable-objects/agent-run-workflow-protocol";
import type { ProjectSandbox } from "./durable-objects/project-sandbox";

export interface AgentEnv extends AnalyticsBindings {
  AGENT_RUN: DurableObjectNamespace<AgentRun>;
  AGENT_RUN_WORKFLOW: Workflow<AgentRunWorkflowPayload>;
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_GATE: "closed" | "draining" | "open";
  CHEATCODE_RELEASE_SHA?: string;
  COMPOSIO_API_KEY?: WorkerSecret;
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_ORG_ID?: string;
  DAYTONA_PREVIEW_HOST_SUFFIXES?: string;
  DAYTONA_TARGET: string;
  DAYTONA_WORKSPACE_VOLUME: string;
  HYPERDRIVE: Hyperdrive;
  OUTPUT_DOWNLOAD_BASE_URL?: string;
  OUTPUT_DOWNLOAD_SIGNING_SECRET: WorkerSecret;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
  PREVIEW_HOSTNAME: string;
  PROJECT_SANDBOX: DurableObjectNamespace<ProjectSandbox>;
  QUOTA_TRACKER: DurableObjectNamespace;
  R2_AUDIT: R2Bucket;
  R2_OUTPUTS: R2Bucket;
  RELEASE_DATABASE_READINESS_SECRET: WorkerSecret;
  SANDBOX_STATE?: KVNamespace;
  SKILL_RUNTIME_BASE_URL: string;
  SKILL_RUNTIME_TOKEN_SECRET: WorkerSecret;
  WEBHOOKS_TO_AGENT_LIFECYCLE_SECRET: WorkerSecret;
}
