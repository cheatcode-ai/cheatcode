import type { AgentCapabilityName } from "@cheatcode/types";
import { Mastra } from "@mastra/core";
import { InMemoryStore } from "@mastra/core/storage";
import { generalAgent } from "./agents";
import { deepResearch, deepResearchFanout } from "./workflows";

type CheatcodeMastra = {
  getAgent(name: AgentCapabilityName): typeof generalAgent;
  getWorkflow(name: "deepResearch"): typeof deepResearch;
  getWorkflow(name: "deepResearchFanout"): typeof deepResearchFanout;
};

const cheatcodeAgents = {
  general: generalAgent,
} as const satisfies Record<AgentCapabilityName, typeof generalAgent>;

const mastraInstance = new Mastra({
  agents: cheatcodeAgents,
  storage: new InMemoryStore({ id: "cheatcode-ephemeral-execution" }),
  workflows: {
    deepResearch,
    deepResearchFanout,
  },
});

function getAgent(name: AgentCapabilityName): typeof generalAgent {
  return mastraInstance.getAgent(name);
}

function getWorkflow(name: "deepResearch"): typeof deepResearch;
function getWorkflow(name: "deepResearchFanout"): typeof deepResearchFanout;
function getWorkflow(
  name: "deepResearch" | "deepResearchFanout",
): typeof deepResearch | typeof deepResearchFanout {
  if (name === "deepResearch") {
    return mastraInstance.getWorkflow("deepResearch");
  }
  return mastraInstance.getWorkflow("deepResearchFanout");
}

export const mastra: CheatcodeMastra = {
  getAgent,
  getWorkflow,
};
