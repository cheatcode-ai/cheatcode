import { createSkillTool, stringOption } from "@cheatcode/sandbox-skills-runtime";
import { type RequestManagedSkillChangeResponse, requestManagedSkillsJson } from "../_shared";

async function main() {
  await createSkillTool({
    name: "disable",
    description: "Prepare a global disable request for a Cheatcode tool.",
    help: "Returns the result of attempting to disable a Cheatcode tool globally. If user action is needed, Cheatcode presents the relevant confirmation UI automatically.",
    options: {
      skill: stringOption({
        description: "Tool slug to disable.",
        short: "s",
        required: true,
      }),
    },
    action: async ({ logger, options }) => {
      const response = await requestManagedSkillsJson<RequestManagedSkillChangeResponse>({
        path: "/managed-skills/prepare-change",
        body: {
          skillSlug: options.skill,
          action: "disable",
        },
      });

      logger.log(JSON.stringify(response, null, 2));
    },
  }).run();
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Failed to prepare the Cheatcode tool disable request.";
  console.error(message);
  process.exitCode = 1;
});
