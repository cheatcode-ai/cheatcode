import { AGENT_MODEL_CATALOG, type CatalogModelId } from "@cheatcode/types";

export const DEFAULT_AGENT_MODEL_ID = "auto";

export type AgentModelId = "auto" | CatalogModelId;
export type AgentModelProvider = "auto" | (typeof AGENT_MODEL_CATALOG)[number]["provider"];

export interface AgentModelOption {
  description: string;
  id: AgentModelId;
  label: string;
  provider: AgentModelProvider;
  requestValue: string | undefined;
}

export const DEFAULT_AGENT_MODEL_OPTION: AgentModelOption = {
  description: "Cheatcode chooses the production default for the current run.",
  id: DEFAULT_AGENT_MODEL_ID,
  label: "Auto",
  provider: "auto",
  requestValue: undefined,
};

// Re-derived from the single catalog in @cheatcode/types so the picker never drifts.
// Shape `{ id, label, provider, requestValue, description }` is a stable contract for ModelMenu.
export const AGENT_MODEL_OPTIONS: readonly AgentModelOption[] = [
  DEFAULT_AGENT_MODEL_OPTION,
  ...AGENT_MODEL_CATALOG.map((entry) => ({
    description: entry.description,
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    requestValue: entry.id,
  })),
];

export function agentModelLabel(modelId: AgentModelId): string {
  return agentModelOption(modelId).label;
}

export function agentModelRequestValue(modelId: AgentModelId): string | undefined {
  return agentModelOption(modelId).requestValue;
}

export function isAgentModelId(value: unknown): value is AgentModelId {
  return typeof value === "string" && AGENT_MODEL_OPTIONS.some((option) => option.id === value);
}

function agentModelOption(modelId: AgentModelId): AgentModelOption {
  return AGENT_MODEL_OPTIONS.find((option) => option.id === modelId) ?? DEFAULT_AGENT_MODEL_OPTION;
}
