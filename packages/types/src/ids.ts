type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, "UserId">;
export type ProjectId = Brand<string, "ProjectId">;
export type ThreadId = Brand<string, "ThreadId">;
export type AgentRunId = Brand<string, "AgentRunId">;

// Brands originate at the Zod boundary parse.
export const toUserId = (value: string): UserId => value as UserId;
export const toProjectId = (value: string): ProjectId => value as ProjectId;
export const toThreadId = (value: string): ThreadId => value as ThreadId;
export const toAgentRunId = (value: string): AgentRunId => value as AgentRunId;
