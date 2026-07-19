import type { UserDeletionRefundEvidence, UserDeletionRefundIntentRecord } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import { UserId } from "@cheatcode/types";
import { z } from "zod";
import type { UserDeletionPolarPage } from "./user-deletion-polar";

const ProviderStatusSchema = z.enum(["pending", "succeeded", "failed", "canceled"]);
const RefundCandidateSchema = z
  .object({
    amount: z.number().int().positive().max(2_147_483_647),
    currency: z.string().regex(/^[a-z]{3}$/u),
    orderId: z.string().min(1),
  })
  .strict();
const UserDeletionRefundIntentWireSchema = RefundCandidateSchema.extend({
  createdAt: z.string().datetime({ offset: true }),
  generation: z.string().datetime({ offset: true }),
  idempotencyKey: z.string().regex(/^cheatcode:user-deletion-refund:[0-9a-f-]{36}$/u),
  jobId: z.string().uuid(),
  providerRefundId: z.string().min(1).nullable(),
  providerStatus: ProviderStatusSchema.nullable(),
  reconciledAt: z.string().datetime({ offset: true }).nullable(),
  userId: z.string().uuid(),
})
  .strict()
  .superRefine((intent, context) => {
    if (intent.idempotencyKey !== `cheatcode:user-deletion-refund:${intent.jobId}`) {
      context.addIssue({ code: "custom", message: "Refund idempotency identity is inconsistent" });
    }
    const hasProviderEvidence =
      intent.providerRefundId !== null &&
      intent.providerStatus !== null &&
      intent.reconciledAt !== null;
    const hasNoProviderEvidence =
      intent.providerRefundId === null &&
      intent.providerStatus === null &&
      intent.reconciledAt === null;
    if (!hasProviderEvidence && !hasNoProviderEvidence) {
      context.addIssue({ code: "custom", message: "Refund provider evidence is incomplete" });
    }
  });
const UserDeletionRefundEvidenceWireSchema = RefundCandidateSchema.extend({
  providerRefundId: z.string().min(1),
  providerStatus: ProviderStatusSchema,
}).strict();
const UserDeletionPolarPageWireSchema = z
  .object({
    candidate: RefundCandidateSchema.nullable(),
    nextPage: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict();

export type UserDeletionRefundIntentWire = z.infer<typeof UserDeletionRefundIntentWireSchema>;
export type UserDeletionRefundEvidenceWire = z.infer<typeof UserDeletionRefundEvidenceWireSchema>;
type ActionOutcome = "advanced" | "noop";

export interface UserDeletionRefundWorkflowRuntime {
  advance(cursor: string | null, phase: "billing" | "quota"): Promise<ActionOutcome>;
  completeCustomerDeletion(): Promise<boolean>;
  guard(intent: UserDeletionRefundIntentWire): Promise<boolean>;
  inspect(): Promise<UserDeletionPolarPage | null>;
  load(): Promise<UserDeletionRefundIntentWire | null>;
  reconcile(intent: UserDeletionRefundIntentWire): Promise<UserDeletionRefundEvidenceWire | null>;
  record(
    intent: UserDeletionRefundIntentWire,
    evidence: UserDeletionRefundEvidenceWire,
  ): Promise<UserDeletionRefundIntentWire | null>;
  reserve(
    candidate: z.infer<typeof RefundCandidateSchema>,
  ): Promise<UserDeletionRefundIntentWire | null>;
}

export async function processUserDeletionRefund(
  runtime: UserDeletionRefundWorkflowRuntime,
): Promise<ActionOutcome> {
  const existing = await runtime.load();
  if (existing) {
    return settleIntent(runtime, UserDeletionRefundIntentWireSchema.parse(existing));
  }
  const page = await runtime.inspect();
  if (!page) {
    return "noop";
  }
  const inspected = UserDeletionPolarPageWireSchema.parse(page);
  if (!inspected.candidate) {
    return completePageWithoutRefund(runtime, inspected.nextPage);
  }
  const reserved = await runtime.reserve(inspected.candidate);
  return reserved
    ? settleIntent(runtime, UserDeletionRefundIntentWireSchema.parse(reserved))
    : "noop";
}

async function settleIntent(
  runtime: UserDeletionRefundWorkflowRuntime,
  intent: UserDeletionRefundIntentWire,
): Promise<ActionOutcome> {
  if (isSucceededRefund(intent)) {
    return completePageWithoutRefund(runtime, null);
  }
  if (intent.providerStatus === "failed" || intent.providerStatus === "canceled") {
    requireSucceededRefund(intent);
  }
  if (!(await runtime.guard(intent))) {
    return "noop";
  }
  const value = await runtime.reconcile(intent);
  if (!value) {
    return "noop";
  }
  const evidence = UserDeletionRefundEvidenceWireSchema.parse(value);
  const recorded = await runtime.record(intent, evidence);
  if (!recorded) {
    return "noop";
  }
  const current = UserDeletionRefundIntentWireSchema.parse(recorded);
  requireSucceededRefund(current);
  return completePageWithoutRefund(runtime, null);
}

async function completePageWithoutRefund(
  runtime: UserDeletionRefundWorkflowRuntime,
  nextPage: number | null,
): Promise<ActionOutcome> {
  if (nextPage) {
    return runtime.advance(String(nextPage), "billing");
  }
  return (await runtime.completeCustomerDeletion()) ? runtime.advance(null, "quota") : "noop";
}

function requireSucceededRefund(intent: UserDeletionRefundIntentWire): void {
  if (isSucceededRefund(intent)) {
    return;
  }
  const isPending = intent.providerStatus === "pending" || intent.providerStatus === null;
  throw new APIError(
    isPending ? 503 : 409,
    isPending ? "upstream_provider_outage" : "conflict_state_invalid",
    isPending
      ? "Polar refund is pending provider settlement"
      : `Polar refund reached terminal ${intent.providerStatus ?? "unknown"} status`,
    {
      details: { providerRefundId: intent.providerRefundId, providerStatus: intent.providerStatus },
      retriable: isPending,
    },
  );
}

function isSucceededRefund(intent: UserDeletionRefundIntentWire): boolean {
  return intent.providerStatus === "succeeded" && intent.providerRefundId !== null;
}

export function userDeletionRefundIntentToWire(
  intent: UserDeletionRefundIntentRecord,
): UserDeletionRefundIntentWire {
  return UserDeletionRefundIntentWireSchema.parse({
    ...intent,
    createdAt: intent.createdAt.toISOString(),
    generation: intent.generation.toISOString(),
    reconciledAt: intent.reconciledAt?.toISOString() ?? null,
  });
}

export function userDeletionRefundIntentFromWire(
  value: UserDeletionRefundIntentWire,
): UserDeletionRefundIntentRecord {
  const intent = UserDeletionRefundIntentWireSchema.parse(value);
  return {
    ...intent,
    createdAt: new Date(intent.createdAt),
    generation: new Date(intent.generation),
    reconciledAt: intent.reconciledAt ? new Date(intent.reconciledAt) : null,
    userId: UserId(intent.userId),
  };
}

export function userDeletionRefundEvidenceToWire(
  evidence: UserDeletionRefundEvidence,
): UserDeletionRefundEvidenceWire {
  return UserDeletionRefundEvidenceWireSchema.parse(evidence);
}
