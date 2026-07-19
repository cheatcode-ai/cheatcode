import { UserId as toUserId, type UserId } from "@cheatcode/types";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  type UserDeletionRefundProviderStatus,
  userDeletionRefundIntents,
} from "./schema/user-deletion-refund-intents";
import { userDeletionJobs } from "./schema/user-deletions";
import type { UserDeletionJobLease } from "./user-deletion-jobs";

export interface UserDeletionRefundLease extends UserDeletionJobLease {
  cursor: string | null;
  generation: Date;
}

export interface UserDeletionRefundCandidate {
  amount: number;
  currency: string;
  orderId: string;
}

export interface UserDeletionRefundIntentRecord extends UserDeletionRefundCandidate {
  createdAt: Date;
  generation: Date;
  idempotencyKey: string;
  jobId: string;
  providerRefundId: string | null;
  providerStatus: UserDeletionRefundProviderStatus | null;
  reconciledAt: Date | null;
  userId: UserId;
}

export interface UserDeletionRefundEvidence {
  amount: number;
  currency: string;
  orderId: string;
  providerRefundId: string;
  providerStatus: UserDeletionRefundProviderStatus;
}

/** Load the immutable refund authority only while the exact billing lease is current. */
export async function loadUserDeletionRefundIntent(
  db: Database,
  lease: UserDeletionRefundLease,
): Promise<UserDeletionRefundIntentRecord | null> {
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    if (!(await lockExactBillingLease(tx, lease))) {
      return null;
    }
    return lockRefundIntent(tx, lease.jobId);
  });
}

/** Create at most one immutable refund identity for a deletion generation. */
export async function reserveUserDeletionRefundIntent(
  db: Database,
  input: UserDeletionRefundLease & UserDeletionRefundCandidate,
): Promise<UserDeletionRefundIntentRecord | null> {
  validateCandidate(input);
  const result = await db.execute(sql`
    select * from public.webhooks_reserve_user_deletion_refund_intent(
      ${input.jobId}::uuid,
      ${input.generation},
      ${input.continuation},
      ${input.leaseToken}::uuid,
      ${input.cursor}::text,
      ${input.orderId},
      ${input.amount},
      ${input.currency}
    )
  `);
  return intentFromFunctionRow(result.rows[0]);
}

/** Revalidate the exact lease and immutable intent immediately before calling Polar. */
export async function guardUserDeletionRefundIntent(
  db: Database,
  input: UserDeletionRefundLease & { intent: UserDeletionRefundIntentRecord },
): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    if (!(await lockExactBillingLease(tx, input))) {
      return false;
    }
    const current = await lockRefundIntent(tx, input.jobId);
    assertSameIntent(current, input.intent);
    return true;
  });
}

/** Persist exact provider evidence before the deletion phase can advance. */
export async function recordUserDeletionRefundEvidence(
  db: Database,
  input: UserDeletionRefundLease & {
    evidence: UserDeletionRefundEvidence;
    intent: UserDeletionRefundIntentRecord;
  },
): Promise<UserDeletionRefundIntentRecord | null> {
  validateEvidence(input.evidence);
  assertEvidenceIdentity(input.intent, input.evidence);
  const result = await db.execute(sql`
    select * from public.webhooks_record_user_deletion_refund_evidence(
      ${input.jobId}::uuid,
      ${input.generation},
      ${input.continuation},
      ${input.leaseToken}::uuid,
      ${input.cursor}::text,
      ${input.intent.orderId},
      ${input.intent.amount},
      ${input.intent.currency},
      ${input.intent.idempotencyKey},
      ${input.evidence.providerRefundId},
      ${input.evidence.providerStatus}
    )
  `);
  const recorded = intentFromFunctionRow(result.rows[0]);
  if (recorded) {
    assertSameIntent(recorded, input.intent);
    assertProviderTransition(input.intent, input.evidence);
  }
  return recorded;
}

function lockExactBillingLease(db: Database, lease: UserDeletionRefundLease): Promise<boolean> {
  return db
    .select({ id: userDeletionJobs.id })
    .from(userDeletionJobs)
    .where(
      and(
        eq(userDeletionJobs.id, lease.jobId),
        eq(userDeletionJobs.userId, lease.userId),
        eq(userDeletionJobs.generation, lease.generation),
        eq(userDeletionJobs.continuation, lease.continuation),
        eq(userDeletionJobs.status, "leased"),
        eq(userDeletionJobs.leaseToken, lease.leaseToken),
        eq(userDeletionJobs.phase, "billing"),
        sql`${userDeletionJobs.cursor} is not distinct from ${lease.cursor}`,
      ),
    )
    .for("update")
    .limit(1)
    .then((rows) => rows.length === 1);
}

async function lockRefundIntent(
  db: Database,
  jobId: string,
): Promise<UserDeletionRefundIntentRecord | null> {
  const [intent] = await db
    .select(intentSelection())
    .from(userDeletionRefundIntents)
    .where(eq(userDeletionRefundIntents.jobId, jobId))
    .for("update")
    .limit(1);
  return intent ? { ...intent, userId: toUserId(intent.userId) } : null;
}

function intentSelection() {
  return {
    amount: userDeletionRefundIntents.amount,
    createdAt: userDeletionRefundIntents.createdAt,
    currency: userDeletionRefundIntents.currency,
    generation: userDeletionRefundIntents.generation,
    idempotencyKey: userDeletionRefundIntents.idempotencyKey,
    jobId: userDeletionRefundIntents.jobId,
    orderId: userDeletionRefundIntents.orderId,
    providerRefundId: userDeletionRefundIntents.providerRefundId,
    providerStatus: userDeletionRefundIntents.providerStatus,
    reconciledAt: userDeletionRefundIntents.reconciledAt,
    userId: userDeletionRefundIntents.userId,
  };
}

function assertSameIntent(
  current: UserDeletionRefundIntentRecord | null,
  expected: UserDeletionRefundIntentRecord,
): asserts current is UserDeletionRefundIntentRecord {
  if (!current || immutableIdentity(current) !== immutableIdentity(expected)) {
    throw new Error("User-deletion refund intent identity changed");
  }
}

function immutableIdentity(intent: UserDeletionRefundIntentRecord): string {
  return [
    intent.jobId,
    intent.userId,
    intent.generation.toISOString(),
    intent.orderId,
    intent.amount,
    intent.currency,
    intent.idempotencyKey,
  ].join("\u0000");
}

function assertEvidenceIdentity(
  intent: UserDeletionRefundIntentRecord,
  evidence: UserDeletionRefundEvidence,
): void {
  if (
    evidence.orderId !== intent.orderId ||
    evidence.amount !== intent.amount ||
    evidence.currency !== intent.currency
  ) {
    throw new Error("Polar refund evidence does not match its immutable intent");
  }
}

function assertProviderTransition(
  current: UserDeletionRefundIntentRecord,
  evidence: UserDeletionRefundEvidence,
): void {
  if (current.providerRefundId && current.providerRefundId !== evidence.providerRefundId) {
    throw new Error("Polar refund identity changed during reconciliation");
  }
  if (current.providerStatus && !canTransition(current.providerStatus, evidence.providerStatus)) {
    throw new Error("Polar refund status regressed after terminal reconciliation");
  }
}

function canTransition(
  current: UserDeletionRefundProviderStatus,
  next: UserDeletionRefundProviderStatus,
): boolean {
  return current === "pending" || current === next;
}

function validateCandidate(candidate: UserDeletionRefundCandidate): void {
  if (
    !Number.isSafeInteger(candidate.amount) ||
    candidate.amount < 1 ||
    candidate.amount > 2_147_483_647
  ) {
    throw new Error("User-deletion refund amount must fit a positive Postgres integer");
  }
  if (!/^[a-z]{3}$/u.test(candidate.currency) || !candidate.orderId.trim()) {
    throw new Error("User-deletion refund order identity is invalid");
  }
}

function validateEvidence(evidence: UserDeletionRefundEvidence): void {
  validateCandidate(evidence);
  if (!evidence.providerRefundId.trim()) {
    throw new Error("Polar refund evidence is missing its provider identity");
  }
}

function intentFromFunctionRow(
  row: Record<string, unknown> | undefined,
): UserDeletionRefundIntentRecord | null {
  if (!row) {
    return null;
  }
  const providerStatus = nullableProviderStatus(row["provider_status"]);
  return {
    amount: integerField(row, "amount"),
    createdAt: dateField(row, "created_at"),
    currency: stringField(row, "currency"),
    generation: dateField(row, "generation"),
    idempotencyKey: stringField(row, "idempotency_key"),
    jobId: stringField(row, "job_id"),
    orderId: stringField(row, "order_id"),
    providerRefundId: nullableStringField(row, "provider_refund_id"),
    providerStatus,
    reconciledAt: nullableDateField(row, "reconciled_at"),
    userId: toUserId(stringField(row, "user_id")),
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid user-deletion refund field: ${key}`);
  }
  return value;
}

function nullableStringField(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null ? null : stringField(row, key);
}

function integerField(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid user-deletion refund integer: ${key}`);
  }
  return value;
}

function dateField(row: Record<string, unknown>, key: string): Date {
  const value = row[key];
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid user-deletion refund timestamp: ${key}`);
  }
  return parsed;
}

function nullableDateField(row: Record<string, unknown>, key: string): Date | null {
  return row[key] === null ? null : dateField(row, key);
}

function nullableProviderStatus(value: unknown): UserDeletionRefundProviderStatus | null {
  if (value === null) {
    return null;
  }
  if (value === "pending" || value === "succeeded" || value === "failed" || value === "canceled") {
    return value;
  }
  throw new Error("Invalid user-deletion refund provider status");
}
