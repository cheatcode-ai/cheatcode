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
- `ArtifactRuntime`, artifact upload types, and `ArtifactRuntimeSchema`
- `CodeRuntimeContext`, `CodeRuntimeContextSchema`, and `getCodeRuntimeContext`
- `EnvironmentVariablesSchema`
- `callSandboxMethod`

## Code checks

```bash
pnpm --filter @cheatcode/sandbox-contracts typecheck
pnpm --filter @cheatcode/sandbox-contracts lint
pnpm --filter @cheatcode/sandbox-contracts build
```

## Env

None.
