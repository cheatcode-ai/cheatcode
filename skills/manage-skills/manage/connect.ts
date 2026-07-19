import {
  createSkillTool,
  readProjectSkillRuntimeConfig,
  stringOption,
} from "@cheatcode/sandbox-skills-runtime";
import {
  type RequestManagedSkillConnectResponse,
  requestManagedSkillsJson,
  tryEmitManagedSkillUiActionEvent,
} from "../_shared";

type ConnectLinkResponse = {
  alreadyConnected: boolean;
  redirectUrl?: string;
  integrationSlug: string;
  integrationName: string;
  message?: string;
};

type SkillLogger = {
  log(message: string): void;
};

const CONNECT_OPTIONS = {
  skill: stringOption({
    description: "Integration tool slug whose account should be connected.",
    short: "s",
    required: true,
  }),
};

async function connectManagedSkill(params: { logger: SkillLogger; options: { skill: string } }) {
  const { logger, options } = params;
  const response = await requestManagedSkillsJson<RequestManagedSkillConnectResponse>({
    path: "/managed-skills/prepare-connect-account",
    body: { skillSlug: options.skill },
  });

  if (response.uiAction) {
    const delivered = await tryEmitManagedSkillUiActionEvent({
      toolCallId: `manage-skills-connect:${options.skill}:${Date.now()}`,
      uiAction: response.uiAction,
    });

    if (delivered) {
      logger.log(
        `Connection UI has been presented for ${response.uiAction.integrationName}. If additional integrations in this request also need connection, queue those now so the user sees all chips at once. Connected integrations are auto-enabled. After queuing all required chips, send one short instruction to complete them and wait for the user's next message.`,
      );
      return;
    }
  }

  const runtimeConfig = await readProjectSkillRuntimeConfig();
  if (runtimeConfig.sandboxContext !== "message") {
    logger.log(
      "Could not deliver the connection UI. The user should connect their account through the Cheatcode web app at trycheatcode.com, then retry.",
    );
    return;
  }

  const linkResponse = await requestManagedSkillsJson<ConnectLinkResponse>({
    path: "/managed-skills/connect-link",
    body: {
      skillSlug: options.skill,
      sandboxContext: "message",
      ...(runtimeConfig.deliveryChannel ? { deliveryChannel: runtimeConfig.deliveryChannel } : {}),
    },
  });

  if (linkResponse.alreadyConnected) {
    logger.log(linkResponse.message ?? `${linkResponse.integrationName} is already connected.`);
    return;
  }

  if (linkResponse.redirectUrl) {
    logger.log(
      JSON.stringify(
        {
          connectUrl: linkResponse.redirectUrl,
          integrationSlug: linkResponse.integrationSlug,
          integrationName: linkResponse.integrationName,
          instruction: `Send this link to the user so they can connect their ${linkResponse.integrationName} account. After they complete the connection, you can verify by running cheatcode-skills manage-skills/manage/list.`,
        },
        null,
        2,
      ),
    );
    return;
  }

  logger.log(JSON.stringify(response, null, 2));
}

async function main() {
  await createSkillTool({
    name: "connect",
    description: "Prepare an account connection request for a Cheatcode integration tool.",
    help: "Presents the Cheatcode connection UI for an integration-backed tool when the account is not connected yet. Falls back to generating a direct auth link when no UI is available.",
    options: CONNECT_OPTIONS,
    action: connectManagedSkill,
  }).run();
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Failed to prepare the Cheatcode integration account connection request.";
  console.error(message);
  process.exitCode = 1;
});
