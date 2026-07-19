# @cheatcode/sandbox-contracts

Provider-neutral ports shared by sandbox consumers and implementations. This
package owns only structural runtime contracts, their trust-boundary validators,
and the generic sandbox method dispatcher. Daytona lifecycle and REST client
types remain in `@cheatcode/tools-code`.

`ArtifactRuntimeSchema` requires an object with a callable `put` method, while
`SandboxLikeSchema` requires a callable `runCode` method. Both schemas preserve
the original object identity so Durable Object stubs and request-scoped runtime
objects are not cloned or stripped during validation.

## Public exports

- `SandboxLike`, its method input/output types, and `SandboxLikeSchema`
- `ArtifactRuntime`, artifact upload types, `ArtifactRuntimeSchema`, and the canonical
  `ArtifactKind` type re-exported from `@cheatcode/types/artifacts`; upload results expose durable
  output identity and presentation metadata, not R2 locators or expiring capabilities
- `CodeRuntimeContext`, `CodeRuntimeContextSchema`, and `getCodeRuntimeContext`
- `EnvironmentVariablesSchema`
- `callSandboxMethod`

Long-running processes require a caller-owned stable `processId`. The sandbox uses that identity
as an idempotency slot for replacement, inspection, cleanup, and bounded record reaping; anonymous
fire-and-forget process records are not part of the contract.
Project preview ports have separate allocate and read capabilities so browser
actions can prove that a loopback page is the active project's managed preview
rather than trusting an arbitrary localhost port.

## Code checks

```bash
pnpm --filter @cheatcode/sandbox-contracts typecheck
pnpm --filter @cheatcode/sandbox-contracts lint
pnpm --filter @cheatcode/sandbox-contracts build
```

## Env

None.
