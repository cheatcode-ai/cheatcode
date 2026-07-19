import type { WorkflowStep } from "cloudflare:workers";
import { createHash } from "node:crypto";
import {
  applyCanonicalWorkspaceTransition,
  createDb,
  type Database,
  type HyperdriveConnection,
  listWorkspaceTransitionOwnerIdPage,
  loadWorkspaceTransitionOwner,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import { createLogger } from "@cheatcode/observability";
import { UserId } from "@cheatcode/types";
import { z } from "zod";
import { type AgentStateDeletionEnv, reconcileUserAgentWorkspaces } from "./lifecycle-adapters";

const OWNER_PAGE_SIZE = 50;
const OWNER_PAGES_PER_GENERATION = 40;
const DB_STEP_OPTIONS = {
  retries: { limit: 5, delay: "20 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;
const AGENT_STEP_OPTIONS = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "10 minutes",
} as const;
const ReleaseShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const OwnerIdPageSchema = z
  .object({
    nextCursor: z.string().uuid().nullable(),
    ownerIds: z.array(z.string().uuid()).max(OWNER_PAGE_SIZE),
  })
  .strict();

export interface WorkspaceReconciliationEnv extends AgentStateDeletionEnv {
  CHEATCODE_RELEASE_SHA?: string;
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
}

const WorkspaceReconciliationEvidenceSchema = z
  .object({
    canonicalDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    canonicalWorkspaces: z.number().int().nonnegative(),
    owners: z.number().int().nonnegative(),
    processPortReservationsRemoved: z.number().int().nonnegative(),
    processRecordsRemoved: z.number().int().nonnegative(),
    projectPortsRemoved: z.number().int().nonnegative(),
    releaseSha: ReleaseShaSchema,
    rowsUpdated: z.number().int().nonnegative(),
    sandboxDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    sandboxesAbsent: z.number().int().nonnegative(),
    sandboxesCurrent: z.number().int().nonnegative(),
    sandboxesUpgraded: z.number().int().nonnegative(),
    targetSnapshot: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const sandboxOwners =
      evidence.sandboxesAbsent + evidence.sandboxesCurrent + evidence.sandboxesUpgraded;
    if (sandboxOwners !== evidence.owners) {
      context.addIssue({ code: "custom", message: "Sandbox evidence does not cover every owner." });
    }
    if ((evidence.owners === 0) !== (evidence.targetSnapshot === null)) {
      context.addIssue({ code: "custom", message: "Snapshot target and owner evidence disagree." });
    }
  });

type WorkspaceReconciliationEvidence = z.infer<typeof WorkspaceReconciliationEvidenceSchema>;

const PendingOwnerEvidenceSchema = z
  .object({
    canonicalDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    canonicalWorkspaces: z.number().int().nonnegative(),
    ownerId: z.string().uuid(),
    processPortReservationsRemoved: z.number().int().nonnegative(),
    processRecordsRemoved: z.number().int().nonnegative(),
    projectPortsRemoved: z.number().int().nonnegative(),
    rowsUpdated: z.number().int().nonnegative(),
  })
  .strict();
type PendingOwnerEvidence = z.infer<typeof PendingOwnerEvidenceSchema>;

export const WorkspaceReconciliationPayloadSchema = z
  .object({
    cursor: z.string().uuid().nullable(),
    evidence: WorkspaceReconciliationEvidenceSchema.nullable(),
    generation: z.number().int().nonnegative(),
    kind: z.literal("workspace-reconciliation"),
    pendingOwner: PendingOwnerEvidenceSchema.nullable(),
    releaseSha: ReleaseShaSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    const isInitial = payload.generation === 0;
    if (
      isInitial !==
      (payload.cursor === null && payload.evidence === null && payload.pendingOwner === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only generation zero may start without reconciliation progress.",
      });
    }
    if (payload.evidence && payload.evidence.releaseSha !== payload.releaseSha) {
      context.addIssue({ code: "custom", message: "Reconciliation evidence changed release." });
    }
  });

export type WorkspaceReconciliationPayload = z.infer<typeof WorkspaceReconciliationPayloadSchema>;

export const WorkspaceReconciliationWorkflowResultSchema = z
  .object({
    continuationInstanceId: z.string().min(1).max(100).nullable(),
    evidence: WorkspaceReconciliationEvidenceSchema.nullable(),
    kind: z.literal("workspace-reconciliation"),
    ok: z.literal(true),
  })
  .strict()
  .refine(
    (result) => (result.evidence === null) !== (result.continuationInstanceId === null),
    "A reconciliation generation must either continue or produce final evidence.",
  );

export type WorkspaceReconciliationWorkflowResult = z.infer<
  typeof WorkspaceReconciliationWorkflowResultSchema
>;

export interface WorkspaceReconciliationChunk {
  continuation: WorkspaceReconciliationPayload | null;
  evidence: WorkspaceReconciliationEvidence | null;
}

export async function reconcileCanonicalWorkspaces(
  env: WorkspaceReconciliationEnv,
  payloadInput: WorkspaceReconciliationPayload,
  step: WorkflowStep,
): Promise<WorkspaceReconciliationChunk> {
  const payload = WorkspaceReconciliationPayloadSchema.parse(payloadInput);
  assertReleaseIdentity(env, payload.releaseSha);
  return reconcileWorkspaceGeneration(env, payload, step);
}

async function reconcileWorkspaceGeneration(
  env: WorkspaceReconciliationEnv,
  payload: WorkspaceReconciliationPayload,
  step: WorkflowStep,
): Promise<WorkspaceReconciliationChunk> {
  const evidence = payload.evidence
    ? WorkspaceReconciliationEvidenceSchema.parse({ ...payload.evidence })
    : emptyEvidence(payload.releaseSha);
  let cursor = payload.cursor ?? undefined;
  let pendingOwner = payload.pendingOwner;
  for (let page = 1; page <= OWNER_PAGES_PER_GENERATION; page += 1) {
    const pageCursor = cursor;
    const ownerPage = await loadOwnerIdPage(env, step, pageCursor, page);
    for (const [index, ownerId] of ownerPage.ownerIds.entries()) {
      const label = `${payload.generation}.${page}.${index + 1}`;
      if (pendingOwner && pendingOwner.ownerId !== ownerId) {
        throw new Error("Pending sandbox owner does not match the reconciliation cursor.");
      }
      const owner = await reconcileWorkspaceOwner(
        env,
        payload.releaseSha,
        step,
        ownerId,
        label,
        pendingOwner,
      );
      if (!owner.snapshot.complete) {
        return continuationChunk(
          payload,
          cursor ?? null,
          evidence,
          pendingOwnerEvidence(ownerId, owner),
        );
      }
      mergeOwnerEvidence(evidence, ownerId, owner);
      pendingOwner = null;
      cursor = ownerId;
    }
    assertCursorAdvanced(pageCursor, ownerPage.nextCursor);
    if (!ownerPage.nextCursor) {
      return completedChunk(await recordWorkspaceEvidence(evidence, step));
    }
    cursor = ownerPage.nextCursor;
  }
  return {
    continuation: WorkspaceReconciliationPayloadSchema.parse({
      cursor,
      evidence,
      generation: payload.generation + 1,
      kind: "workspace-reconciliation",
      pendingOwner: null,
      releaseSha: payload.releaseSha,
    }),
    evidence: null,
  };
}

async function loadOwnerIdPage(
  env: WorkspaceReconciliationEnv,
  step: WorkflowStep,
  cursor: string | undefined,
  page: number,
) {
  const value = await step.do(`load workspace owner ids page ${page}`, DB_STEP_OPTIONS, () =>
    withDatabase(env, (db) =>
      listWorkspaceTransitionOwnerIdPage(db, {
        ...(cursor ? { cursor: UserId(cursor) } : {}),
        limit: OWNER_PAGE_SIZE,
      }),
    ),
  );
  return OwnerIdPageSchema.parse(value);
}

async function reconcileWorkspaceOwner(
  env: WorkspaceReconciliationEnv,
  releaseSha: string,
  step: WorkflowStep,
  ownerId: string,
  label: string,
  pendingOwner: PendingOwnerEvidence | null,
) {
  const userId = UserId(ownerId);
  if (pendingOwner) {
    const finalized = await finalizeWorkspaceOwner(env, releaseSha, step, userId, label);
    return { ...pendingOwner, snapshot: finalized.snapshot };
  }
  const prepared = await step.do(
    `prepare workspace owner ${label}`,
    AGENT_STEP_OPTIONS,
    async () => {
      const owner = await requireWorkspaceOwner(env, userId);
      return reconcileUserAgentWorkspaces(env, userId, {
        phase: "prepare",
        projects: owner.projects,
        releaseSha,
      });
    },
  );
  const update = await step.do(`commit workspace owner ${label}`, DB_STEP_OPTIONS, async () => {
    const owner = await requireWorkspaceOwner(env, userId);
    return withDatabase(env, (db) =>
      applyCanonicalWorkspaceTransition(db, { projects: owner.projects, userId }),
    );
  });
  const finalized = await finalizeWorkspaceOwner(env, releaseSha, step, userId, label);
  return {
    ...prepared,
    canonicalWorkspaces: prepared.canonicalWorkspaceCount,
    rowsUpdated: update.updated,
    snapshot: finalized.snapshot,
  };
}

function finalizeWorkspaceOwner(
  env: WorkspaceReconciliationEnv,
  releaseSha: string,
  step: WorkflowStep,
  userId: UserId,
  label: string,
) {
  return step.do(`finalize workspace owner ${label}`, AGENT_STEP_OPTIONS, async () => {
    const owner = await requireWorkspaceOwner(env, userId);
    return reconcileUserAgentWorkspaces(env, userId, {
      phase: "finalize",
      projects: owner.projects,
      releaseSha,
    });
  });
}

function pendingOwnerEvidence(
  ownerId: string,
  owner: Awaited<ReturnType<typeof reconcileWorkspaceOwner>>,
): PendingOwnerEvidence {
  return PendingOwnerEvidenceSchema.parse({
    canonicalDigest: owner.canonicalDigest,
    canonicalWorkspaces: owner.canonicalWorkspaces,
    ownerId,
    processPortReservationsRemoved: owner.processPortReservationsRemoved,
    processRecordsRemoved: owner.processRecordsRemoved,
    projectPortsRemoved: owner.projectPortsRemoved,
    rowsUpdated: owner.rowsUpdated,
  });
}

async function requireWorkspaceOwner(env: WorkspaceReconciliationEnv, userId: UserId) {
  const owner = await withDatabase(env, (db) => loadWorkspaceTransitionOwner(db, userId));
  if (!owner) {
    throw new Error("Workspace owner disappeared during the closed reconciliation window.");
  }
  return owner;
}

function mergeOwnerEvidence(
  evidence: WorkspaceReconciliationEvidence,
  ownerId: string,
  owner: Awaited<ReturnType<typeof reconcileWorkspaceOwner>>,
): void {
  evidence.canonicalDigest = extendDigest(
    evidence.canonicalDigest,
    `${ownerId}:${owner.canonicalDigest}`,
  );
  evidence.owners += 1;
  evidence.canonicalWorkspaces += owner.canonicalWorkspaces;
  evidence.processPortReservationsRemoved += owner.processPortReservationsRemoved;
  evidence.processRecordsRemoved += owner.processRecordsRemoved;
  evidence.projectPortsRemoved += owner.projectPortsRemoved;
  evidence.rowsUpdated += owner.rowsUpdated;
  mergeSnapshotEvidence(evidence, ownerId, owner.snapshot);
}

function mergeSnapshotEvidence(
  evidence: WorkspaceReconciliationEvidence,
  ownerId: string,
  snapshot: Awaited<ReturnType<typeof reconcileWorkspaceOwner>>["snapshot"],
): void {
  if (!snapshot.complete || snapshot.status === "upgrading") {
    throw new Error("Incomplete sandbox snapshot evidence cannot be recorded.");
  }
  if (evidence.targetSnapshot && evidence.targetSnapshot !== snapshot.targetSnapshot) {
    throw new Error("Sandbox snapshot target changed during release reconciliation.");
  }
  evidence.targetSnapshot = snapshot.targetSnapshot;
  evidence.sandboxDigest = extendDigest(
    evidence.sandboxDigest,
    [
      ownerId,
      snapshot.status,
      snapshot.targetSnapshot,
      snapshot.upgradeId,
      snapshot.workspaceDigest,
    ].join(":"),
  );
  if (snapshot.status === "absent") evidence.sandboxesAbsent += 1;
  if (snapshot.status === "current") evidence.sandboxesCurrent += 1;
  if (snapshot.status === "upgraded") evidence.sandboxesUpgraded += 1;
}

async function recordWorkspaceEvidence(
  evidence: WorkspaceReconciliationEvidence,
  step: WorkflowStep,
): Promise<WorkspaceReconciliationEvidence> {
  const verified = WorkspaceReconciliationEvidenceSchema.parse(evidence);
  const recorded = await step.do(
    "record workspace and sandbox reconciliation evidence",
    DB_STEP_OPTIONS,
    async () => verified,
  );
  createLogger().info("workspace_sandbox_reconciliation_completed", { ...recorded });
  return WorkspaceReconciliationEvidenceSchema.parse(recorded);
}

async function withDatabase<T>(
  env: WorkspaceReconciliationEnv,
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

function assertReleaseIdentity(env: WorkspaceReconciliationEnv, releaseSha: string): void {
  if (env.CHEATCODE_RELEASE_SHA !== releaseSha) {
    throw new Error("Webhooks release does not match workspace reconciliation request.");
  }
}

function assertCursorAdvanced(previous: string | undefined, next: string | null): void {
  if (next && next === previous) {
    throw new Error("Workspace owner cursor did not advance.");
  }
}

function completedChunk(evidence: WorkspaceReconciliationEvidence): WorkspaceReconciliationChunk {
  return { continuation: null, evidence };
}

function continuationChunk(
  payload: WorkspaceReconciliationPayload,
  cursor: string | null,
  evidence: WorkspaceReconciliationEvidence,
  pendingOwner: PendingOwnerEvidence,
): WorkspaceReconciliationChunk {
  return {
    continuation: WorkspaceReconciliationPayloadSchema.parse({
      cursor,
      evidence,
      generation: payload.generation + 1,
      kind: "workspace-reconciliation",
      pendingOwner,
      releaseSha: payload.releaseSha,
    }),
    evidence: null,
  };
}

function emptyEvidence(releaseSha: string): WorkspaceReconciliationEvidence {
  return {
    canonicalDigest: createHash("sha256").digest("hex"),
    canonicalWorkspaces: 0,
    owners: 0,
    processPortReservationsRemoved: 0,
    processRecordsRemoved: 0,
    projectPortsRemoved: 0,
    releaseSha,
    rowsUpdated: 0,
    sandboxDigest: createHash("sha256").digest("hex"),
    sandboxesAbsent: 0,
    sandboxesCurrent: 0,
    sandboxesUpgraded: 0,
    targetSnapshot: null,
  };
}

function extendDigest(previous: string, entry: string): string {
  return createHash("sha256").update(previous).update("\n").update(entry).digest("hex");
}

export function workspaceReconciliationInstanceId(
  payloadInput: WorkspaceReconciliationPayload,
): string {
  const payload = WorkspaceReconciliationPayloadSchema.parse(payloadInput);
  const instanceId = `workspace-sandboxes-${payload.releaseSha}-${payload.generation}`;
  if (instanceId.length > 100) {
    throw new Error("Workspace reconciliation Workflow identity is too long.");
  }
  return instanceId;
}
