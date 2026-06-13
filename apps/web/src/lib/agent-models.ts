import { AGENT_MODEL_CATALOG, type CatalogModelId } from "@cheatcode/types";

export const DEFAULT_AGENT_MODEL_ID = "auto";

export type AgentModelId = "auto" | CatalogModelId;

interface AgentModelOption {
  description: string;
  id: AgentModelId;
  label: string;
  requestValue: string | undefined;
}

const AUTO_OPTION: AgentModelOption = {
  description: "Cheatcode chooses the production default for the current run.",
  id: DEFAULT_AGENT_MODEL_ID,
  label: "Auto",
  requestValue: undefined,
};

// Re-derived from the single catalog in @cheatcode/types so the picker never drifts.
// Shape `{ id, label, requestValue, description }` is a stable contract for composer's ModelMenu.
export const AGENT_MODEL_OPTIONS: readonly AgentModelOption[] = [
  AUTO_OPTION,
  ...AGENT_MODEL_CATALOG.map((entry) => ({
    description: entry.description,
    id: entry.id,
    label: entry.label,
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
  return AGENT_MODEL_OPTIONS.find((option) => option.id === modelId) ?? AUTO_OPTION;
}
