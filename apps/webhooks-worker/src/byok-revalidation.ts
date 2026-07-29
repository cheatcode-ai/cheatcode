import { getProviderKeyForRevalidation, validateProviderKey } from "@cheatcode/byok";
import {
  claimProviderKeyRevalidationTargets,
  completeCurrentProviderKeyRevalidation,
  disableCurrentProviderKey,
  type HyperdriveConnection,
  lockUserProviderKeyMutations,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import { APIError, createLogger, safeErrorTelemetry } from "@cheatcode/observability";
import { toUserId, type UserId } from "@cheatcode/types";
import { type Provider, ProviderSchema } from "@cheatcode/types/api";
import { z } from "zod";
import { withDatabase, withUserDatabase } from "./deletion-job-runner";

interface ByokRevalidationEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
}

interface ByokRevalidationInventory {
  checked: number;
  claimed: number;
  disabled: number;
  failed: number;
  invalid: number;
  providers: string[];
  skipped: number;
}

const REVALIDATION_PAGE_SIZE = 10;
const REVALIDATION_PAGES_PER_INSTANCE = 20;
const RevalidationTargetPageSchema = z
  .array(
    z.strictObject({
      fingerprint: z.string().regex(/^[0-9a-f]{12}$/u),
      leaseToken: z.string().uuid(),
      provider: ProviderSchema,
      userId: z.string().uuid(),
    }),
  )
  .max(REVALIDATION_PAGE_SIZE);
const RevalidationOutcomeSchema = z.strictObject({
  checked: z.number().int().min(0).max(1),
  disabled: z.number().int().min(0).max(1),
  failed: z.number().int().min(0).max(1),
  invalid: z.number().int().min(0).max(1),
  skipped: z.number().int().min(0).max(1),
});
type RevalidationTarget = z.infer<typeof RevalidationTargetPageSchema>[number];
type RevalidationOutcome = z.infer<typeof RevalidationOutcomeSchema>;

export async function processByokRevalidation(env: ByokRevalidationEnv): Promise<void> {
  const result = await revalidateProviderKeys(env);
  createLogger().info("byok_revalidation_inventory", {
    checked: result.checked,
    claimed: result.claimed,
    disabled: result.disabled,
    failed: result.failed,
    invalid: result.invalid,
    providers: result.providers,
    skipped: result.skipped,
  });
}

async function revalidateProviderKeys(
  env: ByokRevalidationEnv,
): Promise<ByokRevalidationInventory> {
  const providers = new Set<string>();
  const totals = { checked: 0, claimed: 0, disabled: 0, failed: 0, invalid: 0, skipped: 0 };
  for (let pageNumber = 1; pageNumber <= REVALIDATION_PAGES_PER_INSTANCE; pageNumber += 1) {
    const targets = await claimRevalidationPage(env);
    if (targets.length === 0) {
      break;
    }
    totals.claimed += targets.length;
    for (const target of targets) {
      providers.add(target.provider);
      let outcome: RevalidationOutcome;
      try {
        outcome = RevalidationOutcomeSchema.parse(await revalidateOneProviderKey(env, target));
      } catch (error) {
        createLogger().error("byok_revalidation_target_failed", {
          errorCode: "byok_revalidation_target_failed",
          provider: target.provider,
          ...safeErrorTelemetry(error),
        });
        outcome = { checked: 0, disabled: 0, failed: 1, invalid: 0, skipped: 0 };
      }
      addOutcome(totals, outcome);
    }
    if (targets.length < REVALIDATION_PAGE_SIZE) {
      break;
    }
  }
  return { ...totals, providers: [...providers].sort() };
}

async function claimRevalidationPage(env: ByokRevalidationEnv): Promise<RevalidationTarget[]> {
  const value = await withDatabase(env, (db) =>
    claimProviderKeyRevalidationTargets(db, REVALIDATION_PAGE_SIZE),
  );
  return RevalidationTargetPageSchema.parse(value);
}

async function revalidateOneProviderKey(
  env: ByokRevalidationEnv,
  target: RevalidationTarget,
): Promise<RevalidationOutcome> {
  const userId = toUserId(target.userId);
  const validation = await validateClaimedProviderKey(env, userId, target);
  if (validation === "stale") {
    return { checked: 0, disabled: 0, failed: 0, invalid: 0, skipped: 1 };
  }
  if (validation === "valid") {
    const completed = await completeClaimedProviderKey(env, userId, target);
    return { checked: 1, disabled: 0, failed: 0, invalid: 0, skipped: completed ? 0 : 1 };
  }
  const disabled = await disableClaimedProviderKey(env, userId, target);
  return {
    checked: 1,
    disabled: disabled ? 1 : 0,
    failed: 0,
    invalid: 1,
    skipped: disabled ? 0 : 1,
  };
}

async function validateClaimedProviderKey(
  env: ByokRevalidationEnv,
  userId: UserId,
  target: RevalidationTarget,
): Promise<"invalid" | "stale" | "valid"> {
  const key = await withUserDatabase(env, userId, (db) =>
    getProviderKeyForRevalidation(db, target.provider, target.fingerprint, target.leaseToken),
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
  return withUserDatabase(env, userId, async (db) => {
    await lockUserProviderKeyMutations(db, userId);
    return completeCurrentProviderKeyRevalidation(db, {
      expectedFingerprint: target.fingerprint,
      expectedLeaseToken: target.leaseToken,
      provider: target.provider,
      userId,
    });
  });
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
  return withUserDatabase(env, userId, async (db) => {
    await lockUserProviderKeyMutations(db, userId);
    return disableCurrentProviderKey(db, {
      expectedFingerprint: target.fingerprint,
      expectedLeaseToken: target.leaseToken,
      provider: target.provider,
      reason: "revalidation_invalid",
      userId,
    });
  });
}

function addOutcome(
  totals: Omit<ByokRevalidationInventory, "providers">,
  outcome: RevalidationOutcome,
): void {
  totals.checked += outcome.checked;
  totals.disabled += outcome.disabled;
  totals.failed += outcome.failed;
  totals.invalid += outcome.invalid;
  totals.skipped += outcome.skipped;
}
