import { createSkillTool } from "@cheatcode/sandbox-skills-runtime";
import {
  type ManagedSkillConnectedIntegrationItem,
  renderManagedConnectedAccountsOutput,
  requestManagedSkillsJson,
} from "../_shared";

type ListManagedSkillConnectedAccountsResponse = {
  integrations: ManagedSkillConnectedIntegrationItem[];
};

async function main() {
  await createSkillTool({
    name: "list-accounts",
    description: "List connected Cheatcode integration accounts.",
    help: "Shows all connected integration accounts across Cheatcode-managed integrations, including which account is currently active/default for each integration.",
    action: async ({ logger }) => {
      const response = await requestManagedSkillsJson<ListManagedSkillConnectedAccountsResponse>({
        path: "/managed-skills/connected-accounts",
        method: "GET",
      });

      logger.log(renderManagedConnectedAccountsOutput(response.integrations));
    },
  }).run();
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Failed to list connected Cheatcode integration accounts.";
  console.error(message);
  process.exitCode = 1;
});
