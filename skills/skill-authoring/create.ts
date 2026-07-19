import {
  createSkillTool,
  emitCheatcodeSkillFrontendEvent,
  readProjectSkillRuntimeConfig,
  requestCheatcodeSkillJson,
  stringOption,
} from "@cheatcode/sandbox-skills-runtime";

type RequestCreateCustomSkillResponse = {
  requiresConfirmation: boolean;
  uiAction?: {
    kind: "create_skill";
    skillName: string;
    skillSlug: string;
    requestSummary: string;
    logoUrl?: string | null;
  };
};

type SkillLogger = {
  log(message: string): void;
};

type CreateSkillOptions = {
  name: string;
  skill?: string;
  goal: string;
};

const CREATE_SKILL_OPTIONS = {
  name: stringOption({
    description: "Display name for the new custom skill.",
    short: "n",
    required: true,
  }),
  skill: stringOption({
    description:
      "Optional kebab-case slug for the new custom skill. If omitted, Cheatcode derives one from --name.",
    short: "s",
  }),
  goal: stringOption({
    description: "Concise summary of what the new skill should do and why it should be created.",
    short: "g",
    required: true,
  }),
};

async function startSkillCreation(params: { logger: SkillLogger; options: CreateSkillOptions }) {
  const { logger, options } = params;
  const config = await readProjectSkillRuntimeConfig();
  const response = await requestCheatcodeSkillJson<RequestCreateCustomSkillResponse>({
    config,
    path: "/managed-skills/custom/prepare-create-request",
    method: "POST",
    body: {
      skillName: options.name,
      ...(options.skill ? { skillSlug: options.skill } : {}),
      requestSummary: options.goal,
    },
  });

  if (response.uiAction && config.sandboxContext === "message") {
    logger.log(
      [
        `Skill creation confirmed for ${response.uiAction.skillName} (${response.uiAction.skillSlug}) in messaging.`,
        `Proceed to implement the skill under /workspace/.cheatcode/skills/${response.uiAction.skillSlug}/ now.`,
        `When implementation is complete, persist it with cheatcode-skills skill-authoring/persist/save --skill ${response.uiAction.skillSlug}.`,
      ].join(" "),
    );
    return;
  }

  if (response.uiAction && config.runId) {
    const result = await emitCheatcodeSkillFrontendEvent({
      config,
      event: {
        type: "coding_agent.request_create_skill",
        data: {
          toolCallId: `skill-create:${response.uiAction.skillSlug}:${Date.now()}`,
          ...response.uiAction,
        },
      },
    });

    if (result.delivered) {
      logger.log(
        [
          `Skill Creator confirmation UI has been presented for ${response.uiAction.skillName} (${response.uiAction.skillSlug}).`,
          "Stop here and wait for the user's decision in the UI.",
          "Do not start authoring the new skill in this turn unless Cheatcode later sends a hidden follow-up instruction after confirmation.",
        ].join(" "),
      );
      return;
    }
  }

  logger.log(JSON.stringify(response, null, 2));
}

async function main() {
  await createSkillTool({
    name: "create",
    description:
      "Start creation of a new custom Cheatcode skill with user confirmation when required.",
    help: "Use this first whenever the agent wants to create a brand-new custom Cheatcode skill. In project chat it presents the Skill Creator confirmation card before authoring begins. Messaging contexts can proceed after server-side validation.",
    options: CREATE_SKILL_OPTIONS,
    action: startSkillCreation,
  }).run();
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Failed to start creation of the new custom Cheatcode skill.";
  console.error(message);
  process.exitCode = 1;
});
