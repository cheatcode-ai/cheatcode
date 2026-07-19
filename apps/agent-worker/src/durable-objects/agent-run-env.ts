import type { WorkerSecret } from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";
import type { AgentRunWorkflowPayload } from "./agent-run-workflow-protocol";
import type { ProjectSandbox } from "./project-sandbox";

export interface AgentRunEnv extends AnalyticsBindings {
  AGENT_RUN_WORKFLOW: Workflow<AgentRunWorkflowPayload>;
  CHEATCODE_RELEASE_GATE: "closed" | "draining" | "open";
  CHEATCODE_RELEASE_SHA?: string;
  COMPOSIO_API_KEY?: WorkerSecret;
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  DEEPSEEK_PLATFORM_API_KEY?: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
  OUTPUT_DOWNLOAD_BASE_URL?: string;
  OUTPUT_DOWNLOAD_SIGNING_SECRET: WorkerSecret;
  PREVIEW_HOSTNAME: string;
  PROJECT_SANDBOX: DurableObjectNamespace<ProjectSandbox>;
  QUOTA_TRACKER: DurableObjectNamespace;
  R2_OUTPUTS: R2Bucket;
  SKILL_RUNTIME_BASE_URL: string;
  SKILL_RUNTIME_TOKEN_SECRET: WorkerSecret;
}
