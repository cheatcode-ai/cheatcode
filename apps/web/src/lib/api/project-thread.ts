"use client";

import {
  type ApprovalDecisionRequest,
  type ApprovalDecisionResponse,
  ApprovalDecisionResponseSchema,
  type CheatcodeUIMessage,
  Paginated,
  type ProjectSummary,
  ProjectSummarySchema,
  type Thread,
  ThreadSchema,
  type UIMessageRecord,
  UIMessageRecordSchema,
  type UpdateProject,
} from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

const ThreadMessagePageSchema = Paginated(UIMessageRecordSchema);
const ProjectPageSchema = Paginated(ProjectSummarySchema);
const ThreadPageSchema = Paginated(ThreadSchema);

export interface ProjectThreadBootstrapInput {
  defaultModel?: string | undefined;
  importRepoUrl?: string | undefined;
  prompt: string | null;
  surface: string | null;
}

export interface ProjectThreadBootstrapResult {
  projectId: string;
  threadId: string;
}

export async function bootstrapProjectThread(
  getToken: () => Promise<null | string>,
  input: ProjectThreadBootstrapInput,
): Promise<ProjectThreadBootstrapResult> {
  const project = await createProject(getToken, {
    ...(input.defaultModel === undefined ? {} : { defaultModel: input.defaultModel }),
    ...(input.importRepoUrl === undefined ? {} : { importRepoUrl: input.importRepoUrl }),
    mode: projectMode(input),
    name: projectName(input),
  });
  const thread = await createProjectThread(getToken, project.id, {
    title: threadTitle(input.prompt),
  });
  return { projectId: project.id, threadId: thread.id };
}

export async function listProjects(
  getToken: () => Promise<null | string>,
): Promise<ProjectSummary[]> {
  const response = await authorizedFetch(getToken, "/v1/projects?limit=50");
  const page = ProjectPageSchema.parse(await response.json());
  return page.data;
}

export async function listProjectThreads(
  getToken: () => Promise<null | string>,
  projectId: string,
): Promise<Thread[]> {
  const response = await authorizedFetch(
    getToken,
    `/v1/projects/${encodeURIComponent(projectId)}/threads?limit=5`,
  );
  const page = ThreadPageSchema.parse(await response.json());
  return page.data;
}

export async function getProject(
  getToken: () => Promise<null | string>,
  projectId: string,
): Promise<ProjectSummary> {
  const response = await authorizedFetch(getToken, `/v1/projects/${encodeURIComponent(projectId)}`);
  return ProjectSummarySchema.parse(await response.json());
}

export async function getThread(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<Thread> {
  const response = await authorizedFetch(getToken, `/v1/threads/${encodeURIComponent(threadId)}`);
  return ThreadSchema.parse(await response.json());
}

export async function updateProject(
  getToken: () => Promise<null | string>,
  projectId: string,
  input: UpdateProject,
): Promise<ProjectSummary> {
  const response = await authorizedFetch(
    getToken,
    `/v1/projects/${encodeURIComponent(projectId)}`,
    {
      body: JSON.stringify(input),
      method: "PATCH",
    },
  );
  return ProjectSummarySchema.parse(await response.json());
}

export async function deleteProject(
  getToken: () => Promise<null | string>,
  projectId: string,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export async function cancelRun(
  getToken: () => Promise<null | string>,
  runId: string,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
}

export async function decideRunApproval(
  getToken: () => Promise<null | string>,
  runId: string,
  approvalId: string,
  body: ApprovalDecisionRequest,
): Promise<ApprovalDecisionResponse> {
  const response = await authorizedFetch(
    getToken,
    `/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    { body: JSON.stringify(body), method: "POST" },
  );
  return ApprovalDecisionResponseSchema.parse(await response.json());
}

export async function listThreadMessages(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<CheatcodeUIMessage[]> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads/${encodeURIComponent(threadId)}/messages?limit=100`,
  );
  const page = ThreadMessagePageSchema.parse(await response.json());
  return page.data.map(messageRecordToUiMessage).filter(isCheatcodeUIMessage);
}

async function createProject(
  getToken: () => Promise<null | string>,
  input: {
    budgetCapUsd?: number;
    defaultModel?: string;
    importRepoUrl?: string;
    mode: "app-builder" | "app-builder-mobile" | "general";
    name: string;
  },
) {
  const response = await authorizedFetch(getToken, "/v1/projects", {
    body: JSON.stringify(input),
    method: "POST",
  });
  return ProjectSummarySchema.parse(await response.json());
}

export async function createProjectThread(
  getToken: () => Promise<null | string>,
  projectId: string,
  input: { title: string },
): Promise<Thread> {
  const response = await authorizedFetch(getToken, `/v1/projects/${projectId}/threads`, {
    body: JSON.stringify(input),
    method: "POST",
  });
  return ThreadSchema.parse(await response.json());
}

function messageRecordToUiMessage(record: UIMessageRecord): CheatcodeUIMessage | null {
  const role = uiMessageRole(record.role);
  if (!role) {
    return null;
  }
  return {
    id: record.id,
    parts: record.parts as CheatcodeUIMessage["parts"],
    role,
  };
}

function isCheatcodeUIMessage(value: CheatcodeUIMessage | null): value is CheatcodeUIMessage {
  return value !== null;
}

function uiMessageRole(value: string): CheatcodeUIMessage["role"] | null {
  if (value === "assistant" || value === "system" || value === "user") {
    return value;
  }
  return null;
}

function projectName(input: ProjectThreadBootstrapInput): string {
  return threadTitle(input.prompt);
}

function projectMode(
  input: ProjectThreadBootstrapInput,
): "app-builder" | "app-builder-mobile" | "general" {
  if (input.surface === "mobile") {
    return "app-builder-mobile";
  }
  return input.surface === "web" ? "app-builder" : "general";
}

export function threadTitle(prompt: string | null): string {
  if (!prompt) {
    return "Untitled project";
  }
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 80) {
    return trimmed;
  }
  return `${trimmed.slice(0, 77).trim()}...`;
}
