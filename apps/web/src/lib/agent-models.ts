import { AGENT_MODEL_CATALOG, type CatalogModelId, type LogicalModelId } from "@cheatcode/types";

const AUTO_AGENT_MODEL_ID = "auto";
export const DEFAULT_AGENT_MODEL_ID = AUTO_AGENT_MODEL_ID;

export type AgentModelId = typeof AUTO_AGENT_MODEL_ID | CatalogModelId;
export type AgentModelProvider = "auto" | (typeof AGENT_MODEL_CATALOG)[number]["provider"];

export interface AgentModelOption {
  description: string;
  id: AgentModelId;
  label: string;
  provider: AgentModelProvider;
  requestValue: LogicalModelId | undefined;
}

const AUTO_AGENT_MODEL_OPTION: AgentModelOption = {
  description: "Uses the project's preferred model, then Cheatcode's production default.",
  id: AUTO_AGENT_MODEL_ID,
  label: "Auto",
  provider: "auto",
  requestValue: undefined,
};

// Re-derived from the single catalog in @cheatcode/types so the picker never drifts.
// Shape `{ id, label, provider, requestValue, description }` is a stable contract for ModelMenu.
export const AGENT_MODEL_OPTIONS: readonly AgentModelOption[] = [
  AUTO_AGENT_MODEL_OPTION,
  ...AGENT_MODEL_CATALOG.map((entry) => ({
    description: entry.description,
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    requestValue: entry.id,
  })),
];

export const DEFAULT_AGENT_MODEL_OPTION: AgentModelOption =
  AGENT_MODEL_OPTIONS.find((option) => option.id === DEFAULT_AGENT_MODEL_ID) ??
  AUTO_AGENT_MODEL_OPTION;

export function agentModelRequestValue(modelId: AgentModelId): LogicalModelId | undefined {
  return agentModelOption(modelId).requestValue;
}

export function isAgentModelId(value: unknown): value is AgentModelId {
  return typeof value === "string" && AGENT_MODEL_OPTIONS.some((option) => option.id === value);
}

function agentModelOption(modelId: AgentModelId): AgentModelOption {
  return AGENT_MODEL_OPTIONS.find((option) => option.id === modelId) ?? DEFAULT_AGENT_MODEL_OPTION;
}
