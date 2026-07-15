import {
  type ArtifactRuntime,
  ArtifactRuntimeSchema,
  type SandboxLike,
  SandboxLikeSchema,
} from "@cheatcode/sandbox-contracts";
import { z } from "zod";

export type BrowserProvider = "anthropic" | "google" | "openai";

interface BrowserCredential {
  apiKey: string;
  modelId: string;
  provider: BrowserProvider;
}

export interface BrowserRuntimeContext {
  artifacts?: ArtifactRuntime | undefined;
  credential: BrowserCredential;
  runId: string;
  sandbox: SandboxLike;
}

const BrowserCredentialSchema = z
  .object({
    apiKey: z.string().min(1),
    modelId: z.string().min(1).max(200),
    provider: z.enum(["anthropic", "google", "openai"]),
  })
  .strict();

export const BrowserRuntimeContextSchema = z
  .object({
    artifacts: ArtifactRuntimeSchema.optional(),
    credential: BrowserCredentialSchema,
    runId: z.string().min(1).max(200),
    sandbox: SandboxLikeSchema,
  })
  .strict();
