# Skill Registration And Persistence

This guidance is separate from skill authoring on purpose.

Default rule:
- implement or refine the skill first
- only think about save/register once the code, structure, and entrypoints are in place

What this stage covers:
- saving a newly created skill into Cheatcode-managed state
- saving edits to an already saved custom skill
- registering the skill so it appears in the managed tools list
- refreshing any managed-skill or creator UI state after save
- refreshing enablement and creator UI state after persistence

What this stage does not change:
- the authored tool files under `/workspace/.cheatcode/skills/`
- the runtime contract inside `@cheatcode/sandbox-skills-runtime`
- the basic implementation model for the tool itself
- whether dependencies have already been bootstrapped locally for that skill at execution time

Use this guidance only when one of these is true:
- the user explicitly wants the new skill saved or registered
- the user asked to create a new custom skill or update an existing custom skill and did not explicitly ask for local-only or draft-only output
- the implementation work is complete and the next requested step is persistence
- the user is editing an already managed skill and expects those changes to be saved back into Cheatcode

Default expectation:
- for new or updated custom skills, persistence is part of completion by default
- do not stop after local file creation and validation unless the user explicitly says local-only, draft-only, or stop before saving
- persist the complete reusable package, including supported source, schema, reference, template, and common binary asset files; each file may be at most 1 MiB, and the package may contain at most 128 files and 8 MiB of decoded content
- do not persist lockfiles such as `package-lock.json`, `bun.lock`, or `pnpm-lock.yaml`, and do not persist dependency directories, build output, virtual environments, caches, or other generated artifacts
- a root `.gitignore` in the skill directory is persisted and respected by `cheatcode-skills skill-authoring/persist/save` as an extra exclusion layer for otherwise-allowed files
- saving a root `package.json` is allowed, but persistence does not install those dependencies during save or reload
- dependency bootstrap should happen lazily, inside `/workspace/.cheatcode/skills/<slug>/`, when that specific skill is validated or executed
- treat missing `/workspace/.cheatcode/skills/<slug>/node_modules` as the default signal that the skill's dependencies still need to be installed locally
- do not mutate shared `/home/node/.cheatcode` with `npm install`, `pnpm install`, or `bun install`; if installation is needed, do it only inside the specific skill directory
- after a custom skill is saved, explain it in user-facing terms: what the user can ask Cheatcode to do with it, and that Cheatcode can use it automatically when a future request clearly matches it
- do not default to CLI commands, code snippets, tool paths, or `cheatcode-skills ...` usage examples in that save confirmation unless the user explicitly asks for technical usage or debugging details

Recommended sequence:
1. Implement the skill files and validate them first. For tool-based skills, use `--help` plus at least one representative non-destructive end-to-end invocation when that is safely possible. Prompt-only skills do not need executable validation.
2. Confirm the skill name, scope, and file layout are correct.
3. If the skill depends on third-party runtime packages, include a root `package.json`. Before validating or executing that skill, install dependencies only inside `/workspace/.cheatcode/skills/<slug>/` when needed. Missing local `node_modules` is the default signal to install.
4. Save or register the skill through the existing Cheatcode flow. For new or updated custom skills, prefer `cheatcode-skills skill-authoring/persist/save --skill <slug>` after the files are ready. In project sandboxes, pass `--source-dir /workspace/.cheatcode/skills/<slug>` when you are intentionally persisting the loaded runtime copy.
5. If the custom skill uses a root `.env`, make sure that file is present and not excluded by the skill root `.gitignore` before saving so the persisted skill keeps its secrets after reload.
6. Refresh managed-skill state or tool lists only after persistence succeeds.

Keep the mental model small:
- authoring is one concern
- registration and persistence are a separate follow-up concern
- dependency bootstrap is another concern and happens lazily at validation/use time, not at save time

Avoid:
- over-explaining persistence while the agent is still writing the skill
- blocking implementation on save/register details
- mixing save/register mechanics into every authoring example
- globally installing packages into shared `/home/node/.cheatcode` to fake successful validation of a persisted skill
