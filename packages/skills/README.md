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

## Env

None.
