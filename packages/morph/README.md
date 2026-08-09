# `@cheatcode/morph`

Bounded Cloudflare-compatible client for Morph FastApply. It owns the fixed
Morph API origin, model selection, response validation, byte limits, deadlines,
and transient retry policy used by the agent's existing-file edit tool.

The package intentionally does not use Morph's pre-1.0 SDK. Keeping this small
transport boundary first-party avoids pulling an OpenAI client and unrelated
SDK modules into the agent Worker. `MORPH_API_KEY` is resolved from Cloudflare
Secrets Store only for the active edit request and never reaches model context,
Durable Object storage, or the Daytona sandbox.

## Checks

```bash
pnpm --filter @cheatcode/morph lint
pnpm --filter @cheatcode/morph typecheck
pnpm --filter @cheatcode/morph build
```
