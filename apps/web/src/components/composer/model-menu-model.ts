import {
  AGENT_MODEL_OPTIONS,
  type AgentModelOption,
  type AgentModelProvider,
  DEFAULT_AGENT_MODEL_OPTION,
} from "@/lib/agent-models";

export type AgentModelId = (typeof AGENT_MODEL_OPTIONS)[number]["id"];

export function agentModelOption(modelId: string): AgentModelOption {
  return AGENT_MODEL_OPTIONS.find((option) => option.id === modelId) ?? DEFAULT_AGENT_MODEL_OPTION;
}

export function modelMenuLabel(option: AgentModelOption): string {
  return option.provider === "anthropic" ? option.label.replace(/^Claude\s+/, "") : option.label;
}

export function providerIconClassName(provider: AgentModelProvider): string {
  if (provider === "auto") return "h-full w-full text-primary";
  if (provider === "anthropic") return "h-full w-full text-[#e55f4e]";
  if (provider === "openai") return "h-full w-full text-foreground";
  return "h-full w-full text-[#4169e1]";
}
