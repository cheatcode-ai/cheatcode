import type {
  Database,
  UserDeletionContext,
  UserDeletionRefundEvidence,
  UserDeletionRefundIntentRecord,
  UserDeletionRefundLease,
} from "@cheatcode/db";
import {
  guardUserDeletionRefundIntent,
  loadUserDeletionRefundIntent,
  recordUserDeletionRefundEvidence,
  reserveUserDeletionRefundIntent,
} from "@cheatcode/db";
import type { UserId } from "@cheatcode/types";
import { z } from "zod";
import type { LifecycleEnv } from "./lifecycle-adapters";
import {
  completeUserDeletionPolarBilling,
  inspectUserDeletionPolarPage,
  reconcileUserDeletionPolarRefund,
} from "./user-deletion-polar";
import {
  processUserDeletionRefund,
  type UserDeletionRefundEvidenceWire,
  type UserDeletionRefundIntentWire,
  userDeletionRefundEvidenceToWire,
  userDeletionRefundIntentFromWire,
  userDeletionRefundIntentToWire,
} from "./user-deletion-refund-workflow";

const BillingCursorSchema = z
  .string()
  .regex(/^[1-9]\d*$/u)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

export interface UserDeletionBillingJob {
  continuation: number;
  cursor: string | null;
  generation: string;
  jobId: string;
  leaseToken: string;
  userId: UserId;
}

type ActionOutcome = "advanced" | "noop";

export interface UserDeletionBillingRuntime {
  advance(cursor: string | null, phase: "billing" | "quota"): Promise<ActionOutcome>;
  database<Result extends Rpc.Serializable<Result>>(
    name: string,
    operation: (db: Database) => Promise<Result>,
  ): Promise<Result>;
  directDatabase<Result>(operation: (db: Database) => Promise<Result>): Promise<Result>;
  external<Result extends Rpc.Serializable<Result>>(
    name: string,
    operation: () => Promise<Result>,
  ): Promise<Result | null>;
}

export async function processUserDeletionBilling(
  env: LifecycleEnv,
  context: UserDeletionContext,
  job: UserDeletionBillingJob,
  action: number,
  runtime: UserDeletionBillingRuntime,
): Promise<ActionOutcome> {
  const lease = refundLease(job);
  const stepName = (verb: string): string => `${verb} account refund action ${action}`;
  return processUserDeletionRefund({
    advance: runtime.advance,
    completeCustomerDeletion: () =>
      completeCustomerDeletion(env, context, runtime, stepName("complete")),
    guard: (intent) => runtime.database(stepName("guard"), (db) => guardIntent(db, lease, intent)),
    inspect: () =>
      runtime.external(stepName("inspect"), () =>
        inspectUserDeletionPolarPage(env, context, billingPage(job.cursor)),
      ),
    load: () => runtime.database(stepName("load"), (db) => loadIntent(db, lease)),
    reconcile: (intent) =>
      runtime.external(stepName("reconcile"), () =>
        reconcileIntent(env, context, lease, intent, runtime),
      ),
    record: (intent, evidence) =>
      runtime.database(stepName("record"), (db) => recordIntent(db, lease, intent, evidence)),
    reserve: (candidate) =>
      runtime.database(stepName("reserve"), (db) =>
        reserveUserDeletionRefundIntent(db, { ...lease, ...candidate }).then(nullableIntentToWire),
      ),
  });
}

async function completeCustomerDeletion(
  env: LifecycleEnv,
  context: UserDeletionContext,
  runtime: UserDeletionBillingRuntime,
  stepName: string,
): Promise<boolean> {
  const completed = await runtime.external(stepName, async () => {
    await completeUserDeletionPolarBilling(env, context);
    return true;
  });
  return completed === true;
}

async function reconcileIntent(
  env: LifecycleEnv,
  context: UserDeletionContext,
  lease: UserDeletionRefundLease,
  intentWire: UserDeletionRefundIntentWire,
  runtime: UserDeletionBillingRuntime,
): Promise<UserDeletionRefundEvidenceWire | null> {
  const intent = userDeletionRefundIntentFromWire(intentWire);
  const isCurrent = await runtime.directDatabase((db) =>
    guardUserDeletionRefundIntent(db, { ...lease, intent }),
  );
  if (!isCurrent) {
    return null;
  }
  return userDeletionRefundEvidenceToWire(
    await reconcileUserDeletionPolarRefund(env, context, intent),
  );
}

async function loadIntent(
  db: Database,
  lease: UserDeletionRefundLease,
): Promise<UserDeletionRefundIntentWire | null> {
  return nullableIntentToWire(await loadUserDeletionRefundIntent(db, lease));
}

function guardIntent(
  db: Database,
  lease: UserDeletionRefundLease,
  intentWire: UserDeletionRefundIntentWire,
): Promise<boolean> {
  return guardUserDeletionRefundIntent(db, {
    ...lease,
    intent: userDeletionRefundIntentFromWire(intentWire),
  });
}

async function recordIntent(
  db: Database,
  lease: UserDeletionRefundLease,
  intentWire: UserDeletionRefundIntentWire,
  evidence: UserDeletionRefundEvidence,
): Promise<UserDeletionRefundIntentWire | null> {
  const intent = userDeletionRefundIntentFromWire(intentWire);
  const recorded = await recordUserDeletionRefundEvidence(db, { evidence, intent, ...lease });
  return nullableIntentToWire(recorded);
}

function nullableIntentToWire(
  intent: UserDeletionRefundIntentRecord | null,
): UserDeletionRefundIntentWire | null {
  return intent ? userDeletionRefundIntentToWire(intent) : null;
}

function refundLease(job: UserDeletionBillingJob): UserDeletionRefundLease {
  return { ...job, generation: new Date(job.generation) };
}

function billingPage(cursor: string | null): number {
  return cursor === null ? 1 : BillingCursorSchema.parse(cursor);
}
