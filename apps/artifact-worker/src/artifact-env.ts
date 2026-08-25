import type { CloudflareVersionMetadata, WorkerSecret } from "@cheatcode/env";
import type { AnalyticsBindings } from "@cheatcode/observability";

export interface ArtifactEnv extends AnalyticsBindings {
  CF_VERSION_METADATA?: CloudflareVersionMetadata;
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CHEATCODE_RELEASE_SHA?: string;
  DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
  OUTPUT_DOWNLOAD_BASE_URL?: string;
  OUTPUT_DOWNLOAD_SIGNING_SECRET: WorkerSecret;
  R2_OUTPUTS: R2Bucket;
}
