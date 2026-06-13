import { Mastra } from "@mastra/core";
import { generalAgent } from "./agents";
import { deepResearch, deepResearchFanout } from "./workflows";

type CheatcodeMastra = {
  getAgent(name: "general"): typeof generalAgent;
  getWorkflow(name: "deepResearch"): typeof deepResearch;
  getWorkflow(name: "deepResearchFanout"): typeof deepResearchFanout;
};

const mastraInstance = new Mastra({
  agents: {
    general: generalAgent,
  },
  workflows: {
    deepResearch,
    deepResearchFanout,
  },
});

function getAgent(name: "general"): typeof generalAgent {
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
