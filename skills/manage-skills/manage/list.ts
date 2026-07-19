import { booleanOption, createSkillTool } from "@cheatcode/sandbox-skills-runtime";
import {
  discoverManagedSkillToolPaths,
  type ManagedSkillListItem,
  type ManagedSkillsListFilter,
  renderManagedSkillsListOutput,
  requestManagedSkillsJson,
} from "../_shared";

type ListManagedSkillsResponse = {
  skills: ManagedSkillListItem[];
};

async function main() {
  await createSkillTool({
    name: "list",
    description: "List Cheatcode tools with optional enabled and available filters.",
    help: "Shows built-in tools, integration-backed tools, and saved custom tools. Use --enabled to see only currently active tools, --available to see only tools that are not active yet, or no flags to inspect everything.",
    options: {
      available: booleanOption({
        description: "Show only tools that are not currently enabled or connected.",
      }),
      enabled: booleanOption({
        description: "Show only tools that are currently enabled, connected, or always available.",
      }),
    },
    action: async ({ logger, options }) => {
      if (options.available && options.enabled) {
        throw new Error("Choose only one filter: --available or --enabled.");
      }

      const filter: ManagedSkillsListFilter = options.available
        ? "available"
        : options.enabled
          ? "enabled"
          : "all";

      const response = await requestManagedSkillsJson<ListManagedSkillsResponse>({
        path: "/managed-skills",
        method: "GET",
      });

      const runnableToolPathsBySkillSlug = await discoverManagedSkillToolPaths(response.skills);

      logger.log(
        renderManagedSkillsListOutput(response.skills, runnableToolPathsBySkillSlug, { filter }),
      );
    },
  }).run();
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Failed to list Cheatcode tools.";
  console.error(message);
  process.exitCode = 1;
});
