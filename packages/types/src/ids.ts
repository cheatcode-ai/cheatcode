type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, "UserId">;
export type ProjectId = Brand<string, "ProjectId">;
export type ThreadId = Brand<string, "ThreadId">;
export type AgentRunId = Brand<string, "AgentRunId">;
export type SandboxId = Brand<string, "SandboxId">;
export type MessageId = Brand<string, "MessageId">;
export type AutomationId = Brand<string, "AutomationId">;
export type AutomationRunId = Brand<string, "AutomationRunId">;
export type AutomationRunRequestId = Brand<string, "AutomationRunRequestId">;

export const UserId = (value: string): UserId => value as UserId;
export const ProjectId = (value: string): ProjectId => value as ProjectId;
export const ThreadId = (value: string): ThreadId => value as ThreadId;
export const AgentRunId = (value: string): AgentRunId => value as AgentRunId;
export const SandboxId = (value: string): SandboxId => value as SandboxId;
export const MessageId = (value: string): MessageId => value as MessageId;
export const AutomationId = (value: string): AutomationId => value as AutomationId;
export const AutomationRunId = (value: string): AutomationRunId => value as AutomationRunId;
export const AutomationRunRequestId = (value: string): AutomationRunRequestId =>
  value as AutomationRunRequestId;
