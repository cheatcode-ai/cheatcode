/**
 * Application-side twin of the PL/pgSQL authority in
 * webhooks_record_user_deletion_refund_evidence (drizzle/0000_current_schema.sql),
 * which enforces the same transitions under FOR UPDATE.
 */

import {
  type Database,
  recordUserDeletionRefundEvidence,
  reserveUserDeletionRefundIntent,
  type UserDeletionRefundCandidate,
  type UserDeletionRefundEvidence,
  type UserDeletionRefundIntentRecord,
  type UserDeletionRefundLease,
} from "@cheatcode/db";

export function reserveDeletionRefundIntent(
  db: Database,
  input: UserDeletionRefundLease & UserDeletionRefundCandidate,
): Promise<UserDeletionRefundIntentRecord | null> {
  validateCandidate(input);
  return reserveUserDeletionRefundIntent(db, input);
}

export function recordDeletionRefundEvidence(
  db: Database,
  input: UserDeletionRefundLease & {
    evidence: UserDeletionRefundEvidence;
    intent: UserDeletionRefundIntentRecord;
  },
): Promise<UserDeletionRefundIntentRecord | null> {
  validateEvidence(input.evidence);
  return recordUserDeletionRefundEvidence(db, input, assertProviderTransition);
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
  current: NonNullable<UserDeletionRefundIntentRecord["providerStatus"]>,
  next: UserDeletionRefundEvidence["providerStatus"],
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
