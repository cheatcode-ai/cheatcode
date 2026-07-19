import type { WorkflowStep } from "cloudflare:workers";
import { getProviderKeyForRevalidation, validateProviderKey } from "@cheatcode/byok";
import {
  claimProviderKeyRevalidationTargets,
  completeCurrentProviderKeyRevalidation,
  createDb,
  type Database,
  disableCurrentProviderKey,
  type HyperdriveConnection,
  lockUserProviderKeyMutations,
  withUserContext,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import { APIError, createLogger } from "@cheatcode/observability";
import { type Provider, ProviderSchema, type UserId } from "@cheatcode/types";
import { z } from "zod";

interface ByokRevalidationEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
}

interface ByokRevalidationInventory {
  checked: number;
  claimed: number;
  disabled: number;
  invalid: number;
  providers: string[];
  skipped: number;
}

const REVALIDATION_PAGE_SIZE = 10;
const REVALIDATION_PAGES_PER_INSTANCE = 20;
const DB_STEP_OPTIONS = {
  retries: { limit: 3, delay: "20 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;
const PROVIDER_STEP_OPTIONS = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "1 minute",
} as const;
const RevalidationTargetPageSchema = z
  .array(
    z
      .object({
        fingerprint: z.string().regex(/^[0-9a-f]{12}$/u),
        leaseToken: z.string().uuid(),
        provider: ProviderSchema,
        userId: z.string().uuid(),
      })
      .strict(),
  )
  .max(REVALIDATION_PAGE_SIZE);
const RevalidationOutcomeSchema = z
  .object({
    checked: z.number().int().min(0).max(1),
    disabled: z.number().int().min(0).max(1),
    invalid: z.number().int().min(0).max(1),
    skipped: z.number().int().min(0).max(1),
  })
  .strict();
type RevalidationTarget = z.infer<typeof RevalidationTargetPageSchema>[number];
type RevalidationOutcome = z.infer<typeof RevalidationOutcomeSchema>;

export async function processByokRevalidation(
  env: ByokRevalidationEnv,
  step: WorkflowStep,
): Promise<{ hasMore: boolean }> {
  const result = await revalidateProviderKeys(env, step);
  createLogger().info("byok_revalidation_inventory", {
    checked: result.checked,
    claimed: result.claimed,
    disabled: result.disabled,
    invalid: result.invalid,
    providers: result.providers,
    skipped: result.skipped,
  });
  return {
    hasMore: result.claimed === REVALIDATION_PAGE_SIZE * REVALIDATION_PAGES_PER_INSTANCE,
  };
}

async function revalidateProviderKeys(
  env: ByokRevalidationEnv,
  step: WorkflowStep,
): Promise<ByokRevalidationInventory> {
  const providers = new Set<string>();
  const totals = { checked: 0, claimed: 0, disabled: 0, invalid: 0, skipped: 0 };
  let ordinal = 0;
  for (let pageNumber = 1; pageNumber <= REVALIDATION_PAGES_PER_INSTANCE; pageNumber += 1) {
    const targets = await claimRevalidationPage(env, step, pageNumber);
    if (targets.length === 0) {
      break;
    }
    totals.claimed += targets.length;
    for (const target of targets) {
      ordinal += 1;
      providers.add(target.provider);
      addOutcome(totals, await revalidateProviderKeyStep(env, step, target, ordinal));
    }
    if (targets.length < REVALIDATION_PAGE_SIZE) {
      break;
    }
  }
  return { ...totals, providers: [...providers].sort() };
}

async function claimRevalidationPage(
  env: ByokRevalidationEnv,
  step: WorkflowStep,
  pageNumber: number,
): Promise<RevalidationTarget[]> {
  const value = await step.do(`claim BYOK revalidation page ${pageNumber}`, DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) => claimProviderKeyRevalidationTargets(db, REVALIDATION_PAGE_SIZE)),
  );
  return RevalidationTargetPageSchema.parse(value);
}

async function revalidateProviderKeyStep(
  env: ByokRevalidationEnv,
  step: WorkflowStep,
  target: RevalidationTarget,
  ordinal: number,
): Promise<RevalidationOutcome> {
  const value = await step.do(`revalidate BYOK target ${ordinal}`, PROVIDER_STEP_OPTIONS, () =>
    revalidateOneProviderKey(env, target),
  );
  return RevalidationOutcomeSchema.parse(value);
}

async function revalidateOneProviderKey(
  env: ByokRevalidationEnv,
  target: RevalidationTarget,
): Promise<RevalidationOutcome> {
  const userId = target.userId as UserId;
  const validation = await validateClaimedProviderKey(env, userId, target);
  if (validation === "stale") {
    return { checked: 0, disabled: 0, invalid: 0, skipped: 1 };
  }
  if (validation === "valid") {
    const completed = await completeClaimedProviderKey(env, userId, target);
    return { checked: 1, disabled: 0, invalid: 0, skipped: completed ? 0 : 1 };
  }
  const disabled = await disableClaimedProviderKey(env, userId, target);
  return { checked: 1, disabled: disabled ? 1 : 0, invalid: 1, skipped: disabled ? 0 : 1 };
}

async function validateClaimedProviderKey(
  env: ByokRevalidationEnv,
  userId: UserId,
  target: RevalidationTarget,
): Promise<"invalid" | "stale" | "valid"> {
  const key = await withDatabase(env, (db) =>
    withUserContext(db, userId, (tx) =>
      getProviderKeyForRevalidation(tx, target.provider, target.fingerprint, target.leaseToken),
    ),
  );
  if (!key) {
    return "stale";
  }
  return (await isProviderKeyInvalid(target.provider, key)) ? "invalid" : "valid";
}

async function completeClaimedProviderKey(
  env: ByokRevalidationEnv,
  userId: UserId,
  target: RevalidationTarget,
): Promise<boolean> {
  return withDatabase(env, (db) =>
    withUserContext(db, userId, async (tx) => {
      await lockUserProviderKeyMutations(tx, userId);
      return completeCurrentProviderKeyRevalidation(tx, {
        expectedFingerprint: target.fingerprint,
        expectedLeaseToken: target.leaseToken,
        provider: target.provider,
        userId,
      });
    }),
  );
}

async function isProviderKeyInvalid(provider: Provider, key: string): Promise<boolean> {
  try {
    await validateProviderKey(provider, key);
    return false;
  } catch (error) {
    if (error instanceof APIError && error.code === "byok_key_invalid") {
      return true;
    }
    throw error;
  }
}

async function disableClaimedProviderKey(
  env: ByokRevalidationEnv,
  userId: UserId,
  target: RevalidationTarget,
): Promise<boolean> {
  return withDatabase(env, (db) =>
    withUserContext(db, userId, async (tx) => {
      await lockUserProviderKeyMutations(tx, userId);
      return disableCurrentProviderKey(tx, {
        expectedFingerprint: target.fingerprint,
        expectedLeaseToken: target.leaseToken,
        provider: target.provider,
        reason: "revalidation_invalid",
        userId,
      });
    }),
  );
}

function addOutcome(
  totals: Omit<ByokRevalidationInventory, "providers">,
  outcome: RevalidationOutcome,
): void {
  totals.checked += outcome.checked;
  totals.disabled += outcome.disabled;
  totals.invalid += outcome.invalid;
  totals.skipped += outcome.skipped;
}

async function withDatabase<T>(
  env: ByokRevalidationEnv,
  operation: (db: Database) => Promise<T>,
): Promise<T> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_webhooks",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS,
  });
  try {
    return await operation(db);
  } finally {
    await close();
  }
}
