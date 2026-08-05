import type { AgentCapabilityName } from "@cheatcode/types";
import { Mastra } from "@mastra/core";
import { InMemoryStore } from "@mastra/core/storage";
import { generalAgent, generalStepAgent } from "./agents";
import { deepResearch, deepResearchFanout } from "./workflows";

const cheatcodeAgents = {
  general: generalAgent,
} as const satisfies Record<AgentCapabilityName, typeof generalAgent>;

export const mastra = new Mastra({
  agents: { ...cheatcodeAgents, generalStep: generalStepAgent },
  storage: new InMemoryStore({ id: "cheatcode-ephemeral-execution" }),
  workflows: {
    deepResearch,
    deepResearchFanout,
  },
});
