import type { UIMessage } from "ai";
import type { AgentRunId, UserId } from "./ids";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "canceled";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
}

export type SandboxState = "cold" | "starting" | "ready" | "sleeping" | "failed";

export type CheatcodeDataParts = {
  plan: { v: 1; tasks: Task[]; parallelGroups: number[][] };
  "task-status": { v: 1; taskId: string; status: TaskStatus; error?: string };
  budget: { v: 1; tokensIn: number; tokensOut: number; usdSpent: number; capUsd: number };
  "sandbox-status": { v: 1; status: SandboxState; previewUrl?: string; expoUrl?: string };
  takeover: { v: 1; available: boolean; vncUrl?: string; resumeToken?: string };
  artifact: {
    v: 1;
    filename?: string;
    outputId: string;
    kind: "slide" | "pdf" | "image" | "video" | "audio" | "xlsx" | "docx";
    downloadUrl: string;
    mimeType: string;
    sizeBytes?: number;
  };
  quota: { v: 1; feature: string; remaining: number; limit: number; resetAt: number };
  thinking: { v: 1; text: string; delta: boolean };
  error: { v: 1; code: string; message: string; retriable: boolean };
  seq: { v: 1; seq: number };
};

export type CheatcodeMetadata = {
  runId: AgentRunId;
  modelId: string;
  userId: UserId;
};

export type CheatcodeUIMessage = UIMessage<CheatcodeMetadata, CheatcodeDataParts>;

export type UIMessagePart = {
  type: string;
  [key: string]: unknown;
};
