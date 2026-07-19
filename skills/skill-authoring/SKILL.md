---
name: skill-authoring
description: Create or update project-local Cheatcode skills for direct backend routes, local workflows, or non-Composio external APIs. This is the default skill authoring path.
category: Builder & Apps
tags: skills, authoring, reusable workflows, typescript
compatibility: Requires Skill Creator run intent and the preinstalled cheatcode-skills runtime.
metadata:
  short-description: Create generic Cheatcode skills
---

# Cheatcode Skills

Use this skill when the user wants to create or update a generic custom skill for Cheatcode.

Do not use this skill for one-off task requests that can already be handled by an existing skill or by enabling a suitable tool.

Do not use this skill for deployable app-side Composio integrations.
If the request is for Airtable, Cal, Gmail, GitHub, Google Calendar, Google Docs, Linear, Notion, or another Composio-backed toolkit and the goal is to ship app code, switch to `cheatcode-app-composio`.

Default contract:
- Before authoring a new custom skill, inspect existing Cheatcode tools with `cheatcode-skills manage-skills/manage/list`.
- If a suitable built-in Cheatcode skill already exists for the requested capability, do not create a new custom skill unless the user explicitly says to ignore the built-in option and make a custom one anyway.
- If a suitable built-in skill exists and is disabled, prefer enabling it instead of creating a duplicate custom skill.
- In Skill Creator mode, author and validate the complete package first, then call the native `skill_create` tool exactly once with the exact authored folder slug. That call persists the package immediately and is the only save boundary for a new skill.
- Create or update a skill under `/workspace/.cheatcode/skills/<skill-name>/`.
- Keep the implementation agent-first. These tools are mainly for Cheatcode itself to run in the project sandbox.
- Default to a prompt-only skill when the reusable behavior can live in `SKILL.md` as instructions, workflows, templates, or guidance for commands and CLI tools that are already available in the sandbox.
- Do not create scripts just to wrap built-in or already-available commands. If the reusable behavior is "use these existing commands in this order" or "follow this workflow with these tools," keep it prompt-only.
- Use tool-based skills with `.ts` entrypoints only when the reusable behavior genuinely needs executable logic, durable automation, third-party API integration, auth handling, parsing, validation, or other code that should not be repeated inline in `SKILL.md`.
- If it is unclear whether the user wants a prompt-only skill or a tool-based automation skill, ask before authoring. Do not guess when the request could reasonably fit either model.
- Treat custom skills as separate from the current project's codebase. Building a skill is not a request to pivot, replace, or reorganize the active project around that skill unless the user explicitly asks for project integration work.
- Prefer `@cheatcode/sandbox-skills-runtime` for runtime config, CLI options, and authenticated backend requests.
- `@cheatcode/sandbox-skills-runtime` is provided by the Cheatcode skill runtime. Import it in authored files, but do not add `@cheatcode/sandbox-skills-runtime` to a skill-local `package.json` and do not try to install it from npm.
- For custom Cheatcode skills that need secrets, store them in the skill root `.env` file and read them from `process.env` instead of hardcoding them.
- Keep the skill lean: one capability per skill, one action per tool file when possible.
- Use `cheatcode-skills skill-authoring/persist/save --skill <slug>` when an existing saved custom skill is edited from the computer and needs to be persisted again. New Skill Creator runs persist through the native `skill_create` tool instead.
- If the custom skill has a root `.env`, keep that file up to date and persist it with the rest of the skill so the saved skill still works after reload.
- In project sandboxes, if you need to update an existing saved custom skill that is not loaded yet, enable it first so it is provisioned into `/workspace/.cheatcode/skills/<slug>/`, then edit and persist that custom skill. Do not use this path for built-in or integration skills.
- Persist the complete reusable package: instructions and references; JavaScript, TypeScript, Python, shell, SQL, and style source; JSON/YAML/TOML/XML/XSD schemas and data; templates; and common document, image, font, audio, video, archive, and spreadsheet assets. Each file may be at most 1 MiB; a package may contain at most 128 files and 8 MiB of decoded content.
- Do not persist lockfiles such as `package-lock.json`, `bun.lock`, or `pnpm-lock.yaml`, and do not expect dependency directories, build output, virtual environments, caches, or other generated artifacts to be saved.
- If the skill directory has a root `.gitignore`, `cheatcode-skills skill-authoring/persist/save` persists it and respects it as an extra exclusion layer for otherwise-allowed files.
- Persisting a root `package.json` does not install dependencies during save or reload. Dependency bootstrap should happen lazily, only when validating or executing that specific skill.
- Only author a root `package.json` when the skill truly needs third-party packages beyond Node built-ins and the runtime-provided `@cheatcode/sandbox-skills-runtime`.
- If the skill only uses Node built-ins plus `@cheatcode/sandbox-skills-runtime`, skip `package.json` and skip dependency installation entirely.
- If a custom skill has a root `package.json`, install dependencies inside `/workspace/.cheatcode/skills/<slug>/` before validating or using that skill when the local install is missing or stale.
- Treat a missing `/workspace/.cheatcode/skills/<slug>/node_modules` directory as the default signal that dependencies still need to be installed for that skill.
- Do not run `npm install`, `pnpm install`, or `bun install` in shared `/home/node/.cheatcode`. Only install inside the specific skill directory that owns the `package.json`.
- Treat tool-based skills and prompt-only skills differently during validation.
- For tool-based skills, validate the CLI surface with `--help` and then run at least one representative non-destructive live invocation through the new skill itself when that is safely possible and the required auth/credentials are available.
- If auth or credentials are missing, still validate the CLI surface and any auth guard path, but state clearly that live provider behavior remains unverified until a real authenticated invocation succeeds.
- If dependency installation for a specific skill fails, say so explicitly and do not pretend the skill is ready to use.
- If the user's original goal was to use the new capability right away, continue from build to validation to actual use of the new skill instead of stopping immediately after authoring.
- If the new skill likely requires third-party auth or credentials, end by telling the user that auth is required, which credential or account they need, where to obtain it, and that the custom skill should keep those secrets in its root `.env` file so they persist with the skill.
- After creating or saving a custom skill, explain it in user-facing terms. Tell the user they can ask Cheatcode to do that task directly and that Cheatcode can use the skill automatically when a future request clearly matches it.
- Do not default to CLI commands, code snippets, tool paths, or `cheatcode-skills ...` usage examples after skill creation unless the user explicitly asks for technical usage or debugging details.
- Treat save/register as a distinct workflow step, but do not stop after local file creation for new or updated custom skills unless the user explicitly wants local-only or draft-only output.

Use the lightest shape that fits the request:
```text
/workspace/.cheatcode/skills/<skill-name>/
  SKILL.md
  references/       # optional
```

For tool-based skills that genuinely need executable logic:
```text
/workspace/.cheatcode/skills/<skill-name>/
  SKILL.md
  <category>/
    <action>.ts
  scripts/          # optional Python, shell, or JavaScript helpers
  schemas/          # optional JSON, YAML, XML, or XSD contracts
  assets/           # optional templates and binary assets
  _shared.ts        # optional
  references/       # optional
```

Default implementation model:
1. Determine whether the request is for a tool-based skill or a prompt-only skill.
2. If the reusable behavior is mainly instructions, workflows, templates, decision rules, or usage of sandbox-built-in commands/CLI tools, keep the skill prompt-only.
3. If the reusable behavior needs executable logic, durable automation, or third-party/API integration, make it tool-based.
4. If the request is ambiguous, ask the user whether they want a reusable prompt/workflow skill or a tool-based automation skill.
5. Understand the concrete behavior the user wants, including whether they also want the new capability used immediately after authoring.
6. Run `cheatcode-skills manage-skills/manage/list` to check whether Cheatcode already provides a suitable built-in skill.
7. If a suitable built-in skill already exists, prefer using it directly or enabling it instead of creating a new custom skill, unless the user explicitly asked to ignore the built-in option and create a custom one anyway.
8. Pick a short kebab-case skill name only when custom skill authoring is still necessary.
9. Create or update the skill under `/workspace/.cheatcode/skills/`.
11. For tool-based skills, use `createSkillTool(...)` plus `@cheatcode/sandbox-skills-runtime` helpers.
12. If the tool-based skill calls Cheatcode backend routes, use `requestCheatcodeSkillJson(...)`.
13. Treat `@cheatcode/sandbox-skills-runtime` as runtime-provided. Import it in source files, but do not add it to `package.json` and do not try to install it.
14. If the skill only uses Node built-ins plus `@cheatcode/sandbox-skills-runtime`, skip `package.json` and skip dependency installation entirely.
15. If the skill needs true third-party packages beyond that, you may author a root `package.json`, but do not assume persistence will install it during save or reload.
16. Before validating or executing a custom skill that has a root `package.json`, install dependencies inside `/workspace/.cheatcode/skills/<slug>/` when they are missing or stale. Treat missing local `node_modules` as the default signal to install. Do not install into shared `/home/node/.cheatcode`.
17. For tool-based skills, validate the entrypoint shape with `--help`.
18. For tool-based skills, run at least one representative non-destructive live invocation through the new skill when that is safely possible and the required auth/credentials are available. Prefer readonly actions such as `get`, `list`, `search`, `preview`, or other clearly non-mutating operations.
19. If auth or credentials are missing, still validate CLI wiring and any auth guard path, but say explicitly that the live provider behavior remains unverified until a real authenticated invocation succeeds.
20. If dependency installation for that specific skill fails, say so explicitly and stop rather than pretending the skill is ready.
21. If a tool-based skill cannot be exercised safely end to end, say exactly what blocked validation and what remains unverified.
22. Prompt-only skills do not need executable validation beyond making sure the prompt and file structure are correct.
23. For a new Skill Creator package, call `skill_create` exactly once after validation and pass the exact folder slug under `/workspace/.cheatcode/skills/` so Cheatcode can persist the complete package atomically. For edits to an already-saved skill, persist with `cheatcode-skills skill-authoring/persist/save --skill <slug>`.
24. If the new skill likely requires credentials and they are not already available, explain the missing auth requirement clearly at the end, including where the user can obtain it and that the custom skill should keep those secrets in its root `.env` file so they persist with the skill.
25. After creation or persistence, explain the new skill in user-facing terms: what the user can ask Cheatcode to do with it, and that Cheatcode can use it automatically when a future request clearly matches it. Do not default to CLI commands, code snippets, tool paths, or `cheatcode-skills ...` usage examples unless the user explicitly asks for technical usage or debugging details.
26. If the user's original goal was to perform a task with the new capability, continue immediately after validation and persistence by using the new skill unless the user asked to stop at implementation only.

Read [references/cheatcode-skills.md](references/cheatcode-skills.md) before introducing a new helper or transport pattern.
Read [references/skill-registration.md](references/skill-registration.md) before persisting a new or updated custom skill, and when the user explicitly asks about save/register behavior.

Minimal tool shape for tool-based skills:
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
    description: "Run a project-local Cheatcode action.",
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
        body: { query: options.query },
      });

      logger.log(JSON.stringify(result, null, 2));
    },
  }).run();
}

void main();
```

Keep runtime alignment in mind:
- authored and executable skill files live under `/workspace/.cheatcode/skills/`
- keep skill work separate from project source files unless the user explicitly asks for project integration code
- keep paths and imports compatible with execution from the sandbox skill runtime

Avoid:
- heavy scaffolding
- repo-wide exploration unless blocked
- boilerplate docs the skill does not need
- giant monolithic tools when separate actions are clearer
