import { createSkillTool, stringOption } from "@cheatcode/sandbox-skills-runtime";
import {
  type ManagedSkillConnectedIntegrationItem,
  renderManagedConnectedIntegrationSummary,
  requestManagedSkillsJson,
} from "../_shared";

type SwitchManagedSkillConnectedAccountResponse = {
  success: boolean;
  integrationSlug: string;
  integrationName: string;
  connectedAccountId: string;
  integration: ManagedSkillConnectedIntegrationItem | null;
  integrations: ManagedSkillConnectedIntegrationItem[];
};

async function main() {
  await createSkillTool({
    name: "switch",
    description: "Switch the default Cheatcode integration account by account id.",
    help: "Marks the given connected account as the default account for its integration, so future Cheatcode calls for that integration use it automatically.",
    options: {
      "account-id": stringOption({
        description: "Connected account id to make the default account.",
        short: "a",
        required: true,
      }),
    },
    action: async ({ logger, options }) => {
      const response = await requestManagedSkillsJson<SwitchManagedSkillConnectedAccountResponse>({
        path: "/managed-skills/connected-accounts/default",
        method: "PATCH",
        body: {
          connectedAccountId: options["account-id"],
        },
      });

      logger.log(
        [
          `Switched the default ${response.integrationName} account to ${response.connectedAccountId}.`,
          "",
          response.integration
            ? renderManagedConnectedIntegrationSummary(response.integration)
            : `Integration id: ${response.integrationSlug}`,
        ].join("\n"),
      );
    },
  }).run();
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Failed to switch the default Cheatcode integration account.";
  console.error(message);
  process.exitCode = 1;
});
