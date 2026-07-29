import {
  type ArtifactRuntime,
  ArtifactRuntimeSchema,
  type SandboxLike,
  SandboxLikeSchema,
} from "@cheatcode/sandbox-contracts";
import { z } from "zod";

export type BrowserProvider = "anthropic" | "google" | "openai";
type BrowserSandbox = Pick<
  SandboxLike,
  "allocateProcessPort" | "exec" | "getSignedPreviewUrl" | "killProcess" | "startProcess"
>;

interface BrowserCredential {
  apiKey: string;
  modelId: string;
  provider: BrowserProvider;
}

export interface BrowserRuntimeContext {
  artifacts?: ArtifactRuntime | undefined;
  credential: BrowserCredential;
  runId: string;
  sandbox: BrowserSandbox;
}

const BrowserCredentialSchema = z.strictObject({
  apiKey: z.string().min(1),
  modelId: z.string().min(1).max(200),
  provider: z.enum(["anthropic", "google", "openai"]),
});

export const BrowserRuntimeContextSchema = z.strictObject({
  artifacts: ArtifactRuntimeSchema.optional(),
  credential: BrowserCredentialSchema,
  runId: z.string().min(1).max(200),
  sandbox: SandboxLikeSchema,
});
