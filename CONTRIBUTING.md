# Contributing to Cheatcode

Thanks for helping improve Cheatcode. Read [AGENTS.md](AGENTS.md) before making
changes; it is the canonical architecture, security, and coding guide for
people and coding agents.

## Set up the repository

Use the exact Node and pnpm versions declared in `package.json`, then run:

```bash
nvm install
nvm use
corepack enable
CI=true pnpm install
pnpm dev:setup
```

The guided wizard creates the ignored `.env.local` and `.env.migrate` files,
prepares a dedicated Supabase project, verifies all three runtime database
roles, and can start the Compose stack. A free Supabase project is sufficient.
You also need Clerk development keys and a Daytona API key plus an immutable
sandbox snapshot built from `infra/containers/sandbox`.

Never commit either env file, real credentials, database dumps, or sanitized
copies of secrets. Never run a migration apply against a target you have not
positively identified and reviewed. Migration files are append-only.

Run `pnpm dev:setup --check` for a read-only check of the host, environment,
migration ledger, database connectivity, and signed-context probes.

## Make changes

- Preserve package and application ownership boundaries.
- Read the relevant README before changing a public export, database contract,
  deployment topology, sandbox boundary, or environment surface.
- Use pnpm and Turborepo; do not substitute npm or Yarn.
- Keep unrelated worktree changes intact.
- Follow the strict TypeScript and naming conventions in `AGENTS.md`.

To change or rotate local role passwords, signing secrets, or provider values,
rerun `pnpm dev:setup` and replace the relevant prompted values. Existing values are
preserved by default, missing values are generated, and the idempotent migration,
Vault provisioning, and probe sequence resumes safely. There is intentionally no
separate secret-rotation command.

## Verify changes

Run the full final-tree gate chain before requesting review:

```bash
pnpm lint
pnpm typecheck
pnpm turbo build --force
pnpm deadcode
pnpm architecture:check
pnpm turbo skills:build
```

For user-visible or integration behavior, also exercise the real flow with
`agent-browser --auto-connect --session cheatcode-debug`. Inspect screenshots,
the browser console, network activity, and application logs. Do not add a
parallel browser or product-flow test harness.

Every pull request must include verification notes listing commands run, real
flows exercised, and any omitted check with its reason.

## Commits and pull requests

Use Conventional Commits, for example:

```text
feat(agent): add a research tool
fix(db): preserve tenant context on retry
docs(setup): clarify Daytona snapshots
```

Keep commit subjects and human-authored pull request titles on one line and at
or below 72 characters. Explain why the change is needed, call out migration or
architecture effects, and include the verification notes above.

By contributing repository-owned code, you agree that it is provided under the
root [LICENSE](LICENSE). Assets and third-party materials remain subject to
[NOTICE](NOTICE).
