import {
  AGENT_CAPABILITIES,
  AgentSummarySchema,
  TOOL_CAPABILITIES,
  type ToolDomain,
  ToolSummarySchema,
} from "@cheatcode/types";

export function listToolsRoute(domain: ToolDomain | undefined): Response {
  const tools = domain
    ? TOOL_CAPABILITIES.filter((capability) => capability.domain === domain)
    : TOOL_CAPABILITIES;
  return Response.json(ToolSummarySchema.array().parse(tools));
}

export function listAgentsRoute(): Response {
  return Response.json(AgentSummarySchema.array().parse(AGENT_CAPABILITIES));
}
