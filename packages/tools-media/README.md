# @cheatcode/tools-media

Request-scoped image generation/editing and video generation/extension for the Cheatcode agent.

## Public exports

- `GenerateOrEditMediaInputSchema`
- `GenerateOrEditMediaOutputSchema`
- `executeGenerateOrEditMedia`

The package consumes a Google Gemini BYOK key passed only to the active tool call and a
`CodeRuntimeContext` for sandbox files plus durable R2 artifacts. It never persists or logs keys.

## Checks

```bash
pnpm --filter @cheatcode/tools-media typecheck
pnpm --filter @cheatcode/tools-media lint
pnpm --filter @cheatcode/tools-media build
```

## Environment

No environment variables are read directly. Credentials and artifact runtimes are supplied through
the Mastra request context.
