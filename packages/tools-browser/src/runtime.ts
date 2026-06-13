import type { SandboxLike } from "@cheatcode/tools-code";
import { z } from "zod";

export type BrowserProvider = "anthropic" | "google" | "openai";

export interface BrowserCredential {
  apiKey: string;
  modelId: string;
  provider: BrowserProvider;
}

export interface BrowserRuntimeContext {
  credential: BrowserCredential;
  sandbox: SandboxLike;
}

function isSandboxLike(value: unknown): value is SandboxLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "runCode" in value &&
    typeof (value as { runCode?: unknown }).runCode === "function"
  );
}

export const BrowserCredentialSchema = z
  .object({
    apiKey: z.string().min(1),
    modelId: z.string().min(1).max(200),
    provider: z.enum(["anthropic", "google", "openai"]),
  })
  .strict();

export const BrowserRuntimeContextSchema = z
  .object({
    credential: BrowserCredentialSchema,
    sandbox: z.custom<SandboxLike>(isSandboxLike),
  })
  .strict();
