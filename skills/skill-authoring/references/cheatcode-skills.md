# `@cheatcode/sandbox-skills-runtime`

Use this package as the default foundation for project-local Cheatcode skill tools.

Exports currently available from `packages/cheatcode-skills/src/index.ts`:
- `createSkillTool(...)`: build a single tool entrypoint with typed options and built-in `--help`.
- `createSubcommand(...)`: build subcommands when one entrypoint genuinely needs multiple actions.
- `stringOption(...)`: string CLI option definition.
- `integerOption(...)`: integer CLI option definition with optional `min`, `max`, and `defaultValue`.
- `booleanOption(...)`: boolean flag definition with optional `defaultValue`.
- `readProjectSkillRuntimeConfig()`: load `backendBaseUrl`, `cheatcodeApiKey`, and `projectId` from env/file runtime config.
- `requestCheatcodeSkillJson(...)`: call a Cheatcode backend route with auth and JSON handling.
- `requestCheatcodeComposioToolJson(...)`: low-level direct Composio tool execution helper.
- `requestCheatcodeComposioToolData(...)`: preferred direct-tool helper that unwraps the standard Composio `successful/data/error` envelope.
- `createCheatcodeComposioToolDataRequester("<toolkit-slug>")`: preferred factory for Composio-backed skill-local tool clients.
- `createCheatcodeComposioToolJsonRequester("<toolkit-slug>")`: low-level direct-tool factory when a skill genuinely needs the raw envelope.
- `requestCheatcodeComposioProxyJson(...)`: low-level Composio thin-proxy request helper.
- `createCheatcodeComposioProxyJsonRequester("<toolkit-slug>")`: proxy fallback factory when direct tool execution is not applicable.
- `SkillRuntimeConfig`: canonical runtime config type. Import this instead of re-declaring it.
- `CheatcodeSkillRequestMethod`: shared request method type.

Default usage:
- Prompt-only skill with reusable instructions or workflows: keep the implementation in `SKILL.md`, optionally with supporting `.md` reference files.
- If the skill is mainly guidance for commands or CLI tools that are already available in the sandbox, document that usage in `SKILL.md` instead of creating wrapper scripts.
- Generic skill with local executable logic: use `createSkillTool(...)` plus the option helpers.
- Skill that calls Cheatcode backend routes directly: use `readProjectSkillRuntimeConfig()` plus `requestCheatcodeSkillJson(...)`.
- Composio-backed integration skill: use `readProjectSkillRuntimeConfig()` plus `createCheatcodeComposioToolDataRequester("<toolkit-slug>")`.
- Use the Composio proxy helpers only when the direct tool route cannot express the required behavior.
- Executed custom skills can load a root `.env` file from that skill directory into `process.env` before the tool action runs.
- `@cheatcode/sandbox-skills-runtime` itself is runtime-provided. Import from it in skill source files, but do not add it to a skill-local `package.json` and do not try to install it from npm.
- If a skill only needs Node built-ins plus `@cheatcode/sandbox-skills-runtime`, do not create a `package.json` just for that skill and do not run dependency installation.

Preferred patterns:
- Prompt-only skills can be just `SKILL.md` plus optional reference files.
- One user-facing action per tool file under `/workspace/.cheatcode/skills/<skill>/<category>/<action>.ts`.
- Python, shell, JavaScript, schemas, templates, or binary assets may accompany the skill when they are part of the reusable behavior; persistence restores those package files without treating generated dependencies or build output as source.
- Small `_shared.ts` files for shared output/rendering helpers.
- Small `_runtime*.ts` or `_shared.ts` helpers only when the skill needs shared transport or normalization logic.
- Import `SkillRuntimeConfig` from `@cheatcode/sandbox-skills-runtime`.
- Keep custom skill source separate from the active project's app code unless the user explicitly asks for project integration work.
- For third-party credentials in custom skills, prefer explicit env variable names, store them in the skill root `.env`, and read them from `process.env` during execution.
- Prefer reading credential env vars inside the tool action or runtime helper path rather than at module top level.

Validation expectations for authored skills:
- `--help` is necessary for checking CLI wiring, but it is not sufficient validation for tool-based skills on its own.
- For tool-based skills, run at least one representative non-destructive live invocation through the authored skill when that is safely possible and the required auth/credentials are available.
- Prefer readonly validation paths such as `get`, `list`, `search`, `preview`, or other non-mutating actions.
- If auth or credentials are missing, validate CLI wiring and any auth guard path you can exercise, then say explicitly that live provider behavior remains unverified until a real authenticated invocation succeeds.
- If the skill cannot be exercised safely end to end, call out the exact blocker and what remains unverified.
- Prompt-only skills do not need executable validation.

Avoid:
- Creating scripts just to wrap commands that are already available in the sandbox.
- Hand-rolled CLI parsing.
- Adding `@cheatcode/sandbox-skills-runtime` to skill-local `package.json` files or trying to install it from npm.
- Duplicating auth header logic or backend URL handling.
- Re-declaring the runtime config shape in a skill.
- Re-implementing the same Composio fetch wrapper for each toolkit.

Direct Cheatcode backend example:
```ts
import {
  createSkillTool,
  readProjectSkillRuntimeConfig,
  requestCheatcodeSkillJson,
  stringOption,
} from "@cheatcode/sandbox-skills-runtime";

async function main() {
  await createSkillTool({
    name: "lookup",
    description: "Look something up through Cheatcode.",
    options: {
      query: stringOption({
        description: "Lookup query.",
        short: "q",
        required: true,
      }),
    },
    action: async ({ options, logger }) => {
      const config = await readProjectSkillRuntimeConfig();
      const result = await requestCheatcodeSkillJson({
        config,
        path: "/your/backend/route",
        body: {
          projectId: config.projectId,
          query: options.query,
        },
      });

      logger.log(JSON.stringify(result, null, 2));
    },
  }).run();
}

void main();
```

Composio-backed direct tool example:
```ts
import {
  createCheatcodeComposioToolDataRequester,
  createSkillTool,
  readProjectSkillRuntimeConfig,
  type SkillRuntimeConfig,
} from "@cheatcode/sandbox-skills-runtime";

const requestAcmeTool =
  createCheatcodeComposioToolDataRequester("acme-toolkit");

async function getAcmeThing(config: SkillRuntimeConfig, id: string) {
  return requestAcmeTool<{ id?: string }>({
    config,
    toolSlug: "ACME_GET_THING",
    errorMessage: "Acme did not return the requested thing.",
    arguments: { thing_id: id },
  });
}

async function main() {
  await createSkillTool({
    name: "get",
    description: "Fetch one thing.",
    action: async ({ logger }) => {
      const config = await readProjectSkillRuntimeConfig();
      const result = await getAcmeThing(config, "123");
      logger.log(JSON.stringify(result, null, 2));
    },
  }).run();
}

void main();
```

Composio thin proxy fallback example:
```ts
import {
  createCheatcodeComposioProxyJsonRequester,
  type SkillRuntimeConfig,
} from "@cheatcode/sandbox-skills-runtime";

const requestAcmeProxy =
  createCheatcodeComposioProxyJsonRequester("acme-toolkit");

async function getAcmeThing(config: SkillRuntimeConfig, id: string) {
  return requestAcmeProxy({
    config,
    endpoint: `/v1/things/${id}`,
    method: "GET",
  });
}
```
