# @cheatcode/agent-core

Mastra agents, tool registry, and workflow entrypoints.

## Public exports

- `mastra`
- `generalAgent`
- `cheatcodeTools`
- `buildSystemPrompt`
- `createCodeRequestContext`
- `createAnthropicByokModel`, `createGoogleByokModel`, `createOpenAiByokModel`,
  `createOpenRouterByokModel`

## Code Checks

```bash
pnpm --filter @cheatcode/agent-core typecheck
```

## Env

Provider keys are supplied through BYOK runtime context, not module scope.
Google model selections use `google/<Gemini model id>`, for example
`google/gemini-2.5-flash`. OpenRouter model selections use
`openrouter/<OpenRouter model id>`, for example `openrouter/openrouter/auto`.
