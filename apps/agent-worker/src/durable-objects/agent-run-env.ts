import type { WorkerSecret } from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";
import type { ProjectSandbox } from "./project-sandbox";

export interface AgentRunEnv extends AnalyticsBindings {
  COMPOSIO_API_KEY?: WorkerSecret;
  DEEPSEEK_PLATFORM_API_KEY?: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
  OUTPUT_DOWNLOAD_BASE_URL?: string;
  OUTPUT_DOWNLOAD_SIGNING_SECRET: string;
  PREVIEW_HOSTNAME?: string;
  PROJECT_SANDBOX: DurableObjectNamespace<ProjectSandbox>;
  QUOTA_TRACKER?: DurableObjectNamespace;
  R2_OUTPUTS: R2Bucket;
  R2_OUTPUTS_BUCKET_NAME?: string;
}
