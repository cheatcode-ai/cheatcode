import { createSkillTool, stringOption } from "@cheatcode/sandbox-skills-runtime";
import {
  type RequestManagedSkillChangeResponse,
  requestManagedSkillsJson,
  tryEmitManagedSkillUiActionEvent,
} from "../_shared";

async function main() {
  await createSkillTool({
    name: "enable",
    description: "Prepare a global enable request for a Cheatcode tool.",
    help: "Returns the result of attempting to enable a Cheatcode tool globally. For integration-backed tools, connection is the primary setup path and connected integrations are auto-enabled.",
    options: {
      skill: stringOption({
        description: "Tool slug to enable.",
        short: "s",
        required: true,
      }),
    },
    action: async ({ logger, options }) => {
      const response = await requestManagedSkillsJson<RequestManagedSkillChangeResponse>({
        path: "/managed-skills/prepare-change",
        body: {
          skillSlug: options.skill,
          action: "enable",
        },
      });

      if (response.uiAction) {
        const delivered = await tryEmitManagedSkillUiActionEvent({
          toolCallId: `manage-skills-enable:${options.skill}:${Date.now()}`,
          uiAction: response.uiAction,
        });

        if (delivered) {
          logger.log(
            response.uiAction.kind === "connect_account"
              ? `Connection UI has been presented for ${response.uiAction.integrationName}. If additional integrations in this request also need connection, queue those now so the user sees all chips at once. Connected integrations are auto-enabled. After queuing all required chips, send one short instruction to complete them and wait for the user's next message.`
              : `Enable UI has been presented for ${response.uiAction.integrationName}. If additional integrations in this request also need connection, queue those now so the user sees all chips at once. Connected integrations are auto-enabled. After queuing all required chips, send one short instruction to complete them and wait for the user's next message.`,
          );
          return;
        }

        logger.log(JSON.stringify(response, null, 2));
        return;
      }

      logger.log(JSON.stringify(response, null, 2));
    },
  }).run();
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Failed to prepare the Cheatcode tool enable request.";
  console.error(message);
  process.exitCode = 1;
});
