import type { AgentRunId, ProjectId, UserId } from "@cheatcode/types";
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import { lockUserProjectMutations } from "./projects";
import {
  agentRuns,
  artifactUploadIntents,
  generatedOutputs,
  projects,
  threads,
  users,
} from "./schema";

const REMOTE_SIDE_EFFECT_GRACE_MS = 2 * 60 * 60 * 1000;

export interface ArtifactUploadIdentity {
  agentRunId: AgentRunId;
  id: string;
  projectId: ProjectId;
  r2Key: string;
  userId: UserId;
}

export interface ArtifactUploadIntentRecord {
  id: string;
  r2Key: string;
}

export interface QuiescedArtifactUploadIntentRecord extends ArtifactUploadIntentRecord {
  cleanupNotBefore: Date;
  quiescedAt: Date;
}

export interface FinalizeArtifactUploadInput extends ArtifactUploadIdentity {
  createdAt: Date;
  filename: string;
  mimeType: string;
}

export type ReserveArtifactUploadResult =
  | { state: "committed" }
  | { state: "fenced" }
  | { state: "reserved" };

export type GuardArtifactUploadResult = ReserveArtifactUploadResult | { state: "reservation-lost" };

export type FinalizeArtifactUploadResult =
  | { isFirstForUser: boolean; state: "committed" }
  | { state: "fenced" }
  | { state: "reservation-lost" };

/** Reserve an exact cross-store identity while locking its live ownership graph. */
export async function reserveArtifactUpload(
  db: Database,
  input: ArtifactUploadIdentity,
): Promise<ReserveArtifactUploadResult> {
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    await lockUserProjectMutations(tx, input.userId);
    const committed = await reconcileCommittedOutput(tx, input);
    if (committed) {
      return { state: committed };
    }
    if (!(await lockActiveUploadOwnership(tx, input))) {
      return { state: "fenced" };
    }
    const existing = await lockUploadIntent(tx, input.id);
    if (existing) {
      assertIntentIdentity(existing, input);
      await extendCleanupGrace(tx, input.id);
      return { state: "reserved" };
    }
    await tx.insert(artifactUploadIntents).values({
      ...input,
      cleanupNotBefore: cleanupNotBefore(),
    });
    return { state: "reserved" };
  });
}

/** Revalidate the exact reservation immediately before mutating R2. */
export async function guardArtifactUpload(
  db: Database,
  input: ArtifactUploadIdentity,
): Promise<GuardArtifactUploadResult> {
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    await lockUserProjectMutations(tx, input.userId);
    const committed = await reconcileCommittedOutput(tx, input);
    if (committed) {
      return { state: committed };
    }
    if (!(await lockActiveUploadOwnership(tx, input))) {
      return { state: "fenced" };
    }
    const intent = await lockUploadIntent(tx, input.id);
    if (!intent) {
      return { state: "reservation-lost" };
    }
    assertIntentIdentity(intent, input);
    await extendCleanupGrace(tx, input.id);
    return { state: "reserved" };
  });
}

/** Publish DB visibility only after R2 succeeded, replacing the intent atomically. */
export async function finalizeArtifactUpload(
  db: Database,
  input: FinalizeArtifactUploadInput,
): Promise<FinalizeArtifactUploadResult> {
  return db.transaction(async (transaction) => {
    const tx = transaction as Database;
    await lockUserProjectMutations(tx, input.userId);
    const committed = await reconcileCommittedOutput(tx, input);
    if (committed === "committed") {
      return { isFirstForUser: false, state: "committed" };
    }
    if (committed === "fenced" || !(await lockActiveUploadOwnership(tx, input))) {
      return { state: "fenced" };
    }
    const intent = await lockUploadIntent(tx, input.id);
    if (!intent) {
      return { state: "reservation-lost" };
    }
    assertIntentIdentity(intent, input);
    return commitGeneratedOutput(tx, input);
  });
}

async function commitGeneratedOutput(
  db: Database,
  input: FinalizeArtifactUploadInput,
): Promise<FinalizeArtifactUploadResult> {
  await db.insert(generatedOutputs).values({
    agentRunId: input.agentRunId,
    createdAt: input.createdAt,
    filename: input.filename,
    id: input.id,
    mimeType: input.mimeType,
    r2Key: input.r2Key,
    userId: input.userId,
  });
  const first = await db
    .update(users)
    .set({ firstArtifactAt: input.createdAt })
    .where(and(eq(users.id, input.userId), isNull(users.firstArtifactAt)))
    .returning({ id: users.id });
  const removed = await db
    .delete(artifactUploadIntents)
    .where(
      and(eq(artifactUploadIntents.id, input.id), eq(artifactUploadIntents.r2Key, input.r2Key)),
    )
    .returning({ id: artifactUploadIntents.id });
  if (removed.length !== 1) {
    throw new Error("Artifact upload intent changed during finalization");
  }
  return { isFirstForUser: first.length === 1, state: "committed" };
}

export async function listQuiescedArtifactUploadIntents(
  db: Database,
  input: { before: Date; limit: number },
): Promise<QuiescedArtifactUploadIntentRecord[]> {
  const rows = await db
    .select(quiescedIntentRecordSelection())
    .from(artifactUploadIntents)
    .innerJoin(
      agentRuns,
      and(
        eq(agentRuns.id, artifactUploadIntents.agentRunId),
        eq(agentRuns.userId, artifactUploadIntents.userId),
      ),
    )
    .where(
      and(
        isNotNull(artifactUploadIntents.quiescedAt),
        lte(artifactUploadIntents.cleanupNotBefore, input.before),
        lte(artifactUploadIntents.quiescedAt, input.before),
        inArray(agentRuns.status, ["completed", "failed", "canceled"]),
        isNotNull(agentRuns.finishedAt),
      ),
    )
    .orderBy(
      artifactUploadIntents.cleanupNotBefore,
      artifactUploadIntents.quiescedAt,
      artifactUploadIntents.id,
    )
    .limit(boundedIntentPage(input.limit));
  return rows.map(requireQuiescedIntent);
}

/** Delete only terminal-run intents carrying an awaited-artifact quiescence proof. */
export async function deleteQuiescedArtifactUploadIntents(
  db: Database,
  input: {
    before: Date;
    intents: readonly QuiescedArtifactUploadIntentRecord[];
  },
): Promise<number> {
  if (input.intents.length === 0) {
    return 0;
  }
  const rows = await db
    .delete(artifactUploadIntents)
    .where(
      and(
        isNotNull(artifactUploadIntents.quiescedAt),
        lte(artifactUploadIntents.cleanupNotBefore, input.before),
        lte(artifactUploadIntents.quiescedAt, input.before),
        sql`exists (
          select 1
            from ${agentRuns} terminal_run
           where terminal_run.id = ${artifactUploadIntents.agentRunId}
             and terminal_run.user_id = ${artifactUploadIntents.userId}
             and terminal_run.status in ('completed', 'failed', 'canceled')
             and terminal_run.finished_at is not null
        )`,
        or(...input.intents.map(quiescedIntentRecordIdentity)),
      ),
    )
    .returning({ id: artifactUploadIntents.id });
  return rows.length;
}

export async function listUserArtifactUploadIntents(
  db: Database,
  input: { deletionFence: string; limit: number; userId: UserId },
): Promise<ArtifactUploadIntentRecord[]> {
  await requireUserDeletionFence(db, input.userId, input.deletionFence);
  return db
    .select(intentRecordSelection())
    .from(artifactUploadIntents)
    .where(eq(artifactUploadIntents.userId, input.userId))
    .orderBy(artifactUploadIntents.id)
    .limit(boundedIntentPage(input.limit));
}

export async function deleteUserArtifactUploadIntents(
  db: Database,
  input: {
    deletionFence: string;
    intents: readonly ArtifactUploadIntentRecord[];
    userId: UserId;
  },
): Promise<number> {
  await requireUserDeletionFence(db, input.userId, input.deletionFence);
  if (input.intents.length === 0) {
    return 0;
  }
  const rows = await db
    .delete(artifactUploadIntents)
    .where(
      and(
        eq(artifactUploadIntents.userId, input.userId),
        or(...input.intents.map(intentRecordIdentity)),
      ),
    )
    .returning({ id: artifactUploadIntents.id });
  return rows.length;
}

function lockActiveUploadOwnership(
  db: Database,
  input: ArtifactUploadIdentity,
): Promise<{ id: string } | undefined> {
  return db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .innerJoin(
      threads,
      and(eq(threads.id, agentRuns.threadId), eq(threads.userId, agentRuns.userId)),
    )
    .innerJoin(
      projects,
      and(eq(projects.id, threads.projectId), eq(projects.userId, threads.userId)),
    )
    .innerJoin(users, eq(users.id, agentRuns.userId))
    .where(
      and(
        eq(agentRuns.id, input.agentRunId),
        eq(agentRuns.userId, input.userId),
        eq(projects.id, input.projectId),
        eq(threads.activeRunId, input.agentRunId),
        inArray(agentRuns.status, ["pending", "running"]),
        isNull(agentRuns.finishedAt),
        isNull(threads.deletedAt),
        isNull(projects.deletedAt),
        isNull(users.deletedAt),
        isNull(users.deletionFence),
      ),
    )
    .for("update")
    .limit(1)
    .then((rows) => rows[0]);
}

async function reconcileCommittedOutput(
  db: Database,
  input: ArtifactUploadIdentity,
): Promise<"committed" | "fenced" | null> {
  const output = await lockCommittedOutput(db, input.id);
  if (!output) {
    return null;
  }
  assertCommittedOutputIdentity(output, input);
  return "committed";
}

async function lockCommittedOutput(db: Database, id: string) {
  const [output] = await db
    .select({
      agentRunId: generatedOutputs.agentRunId,
      r2Key: generatedOutputs.r2Key,
      userId: generatedOutputs.userId,
    })
    .from(generatedOutputs)
    .where(eq(generatedOutputs.id, id))
    .for("update")
    .limit(1);
  return output;
}

function assertCommittedOutputIdentity(
  output: NonNullable<Awaited<ReturnType<typeof lockCommittedOutput>>>,
  input: ArtifactUploadIdentity,
): void {
  if (
    output.userId !== input.userId ||
    output.agentRunId !== input.agentRunId ||
    output.r2Key !== input.r2Key
  ) {
    throw new Error("Deterministic artifact identity collided with a different output");
  }
}

async function extendCleanupGrace(db: Database, id: string): Promise<void> {
  const rows = await db
    .update(artifactUploadIntents)
    .set({ cleanupNotBefore: cleanupNotBefore() })
    .where(eq(artifactUploadIntents.id, id))
    .returning({ id: artifactUploadIntents.id });
  if (rows.length !== 1) {
    throw new Error("Artifact upload intent disappeared while extending cleanup grace");
  }
}

async function lockUploadIntent(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(artifactUploadIntents)
    .where(eq(artifactUploadIntents.id, id))
    .for("update")
    .limit(1);
  return row;
}

function assertIntentIdentity(
  intent: typeof artifactUploadIntents.$inferSelect,
  input: ArtifactUploadIdentity,
): void {
  if (
    intent.userId !== input.userId ||
    intent.projectId !== input.projectId ||
    intent.agentRunId !== input.agentRunId ||
    intent.r2Key !== input.r2Key
  ) {
    throw new Error("Deterministic artifact identity collided with a different upload intent");
  }
}

function intentRecordSelection() {
  return {
    id: artifactUploadIntents.id,
    r2Key: artifactUploadIntents.r2Key,
  };
}

function quiescedIntentRecordSelection() {
  return {
    ...intentRecordSelection(),
    cleanupNotBefore: artifactUploadIntents.cleanupNotBefore,
    quiescedAt: artifactUploadIntents.quiescedAt,
  };
}

function requireQuiescedIntent(
  intent: ArtifactUploadIntentRecord & {
    cleanupNotBefore: Date;
    quiescedAt: Date | null;
  },
): QuiescedArtifactUploadIntentRecord {
  if (!intent.quiescedAt) {
    throw new Error("Artifact upload intent lost its quiescence proof");
  }
  return { ...intent, quiescedAt: intent.quiescedAt };
}

function intentRecordIdentity(intent: ArtifactUploadIntentRecord) {
  return and(
    eq(artifactUploadIntents.id, intent.id),
    eq(artifactUploadIntents.r2Key, intent.r2Key),
  );
}

function quiescedIntentRecordIdentity(intent: QuiescedArtifactUploadIntentRecord) {
  return and(
    intentRecordIdentity(intent),
    eq(artifactUploadIntents.cleanupNotBefore, intent.cleanupNotBefore),
    eq(artifactUploadIntents.quiescedAt, intent.quiescedAt),
  );
}

async function requireUserDeletionFence(
  db: Database,
  userId: UserId,
  deletionFence: string,
): Promise<void> {
  const row = await db.query.users.findFirst({
    columns: { id: true },
    where: and(eq(users.id, userId), eq(users.deletionFence, deletionFence)),
  });
  if (!row) {
    throw new Error("Artifact upload cleanup lost its user-deletion fence");
  }
}

function cleanupNotBefore(): Date {
  return new Date(Date.now() + REMOTE_SIDE_EFFECT_GRACE_MS);
}

function boundedIntentPage(limit: number): number {
  return Math.max(1, Math.min(500, Math.trunc(limit)));
}
