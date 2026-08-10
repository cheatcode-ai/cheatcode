# @cheatcode/sandbox-contracts

Provider-neutral ports shared by sandbox consumers and implementations. This
package owns only structural runtime contracts, their trust-boundary validators,
and narrowed tool-facing method sets. Daytona REST client types live behind
`@cheatcode/agent-core/tools/code`.

`ArtifactRuntimeSchema` requires an object with a callable `put` method, while
`SandboxLikeSchema` requires the complete callable sandbox surface. Both schemas preserve
the original object identity so Durable Object stubs and request-scoped runtime
objects are not cloned or stripped during validation.

## Public exports

- `SandboxLike`, its method input/output types, and `SandboxLikeSchema`
- `ArtifactRuntime`, artifact upload types, `ArtifactRuntimeSchema`, and the canonical
  `ArtifactKind` type re-exported from `@cheatcode/types/artifacts`; upload results expose durable
  output identity and presentation metadata, not R2 locators or expiring capabilities
- `CodeRuntimeContext`, `CodeRuntimeContextFor`, and `CodeRuntimeContextSchema`
- `EnvironmentVariablesSchema`

Artifact uploads declare their exposure. `deliverable` outputs are user files;
`internal` outputs use the reserved `.cheatcode-internal-` filename namespace and
support durable agent UI such as browser-step screenshots without entering the
project's Deliverables catalog.

Long-running processes require a caller-owned stable `processId`. The sandbox uses that identity
as an idempotency slot for replacement, inspection, cleanup, and bounded record reaping; anonymous
fire-and-forget process records are not part of the contract. Replacement remains the default;
callers that set `shouldReuseMatchingProcess` ask the implementation to retain a healthy matching
launch or relaunch it after a cold sandbox start. This opt-in fingerprints the effective environment
without retaining its values, so it is reserved for caller-owned, non-secret process configuration.
Project-backed `CodeRuntimeContext` values carry both the canonical `workspaceDir` and the explicit
`workspaceSlug`. Process ownership uses the slug even when the command runs from a nested directory.
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
