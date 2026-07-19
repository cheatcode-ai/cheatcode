# @cheatcode/skills

Build-time skill loader. Worker runtime imports generated TypeScript instead of reading files.

## Public exports

- `SKILLS`
- `buildSystemPromptSection`
- `getSkillByName`

## Code Checks

```bash
pnpm --filter @cheatcode/skills typecheck
```

V2 bundles only skill markdown, references, and assets. It has no bundled skill
scripts, no `evals/evals.json`, no local skill-eval runner, and no
`skill_run_script` tool. Product QA is performed through direct `agent-browser`
UI interaction and log review.

The same top-level `skills/` tree is mounted as the Daytona image's
`default_skills` build context and copied to
`/home/node/.cheatcode/default-skills/` for inspection. Do not maintain a
second snapshot-specific skill copy. User-authored skills remain database
records with editable mirrors under `/workspace/.cheatcode/skills/`.

The catalog intentionally contains no deploy skill: Cheatcode can build and
preview user projects, but it does not deploy or synchronize them.

## Env

None.
