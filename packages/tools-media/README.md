# @cheatcode/tools-media

Provider-backed media tools for Cheatcode V2.

## Exports

- FAL image and video generation executors
- ElevenLabs text-to-speech and speech-to-text executors
- Zod input/output schemas for Mastra tool registration

All paid provider keys are supplied through request-scoped BYOK runtime context.
Generated media is persisted through the shared artifact runtime, which writes to
R2 and returns Worker-signed download URLs.

## Code Checks

```bash
pnpm --filter @cheatcode/tools-media typecheck
pnpm --filter @cheatcode/tools-media lint
```
