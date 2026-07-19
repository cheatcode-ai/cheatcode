import { z } from "zod";

export const SNAPSHOT_RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const UPGRADE_ID_PATTERN = /^[0-9a-f]{32}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

const SnapshotUpgradeStateBaseSchema = z
  .object({
    archiveDigest: z.string().regex(DIGEST_PATTERN).nullable(),
    archiveSize: z.number().int().positive().nullable(),
    candidateId: z.string().min(1).max(500).nullable(),
    chunkCount: z.number().int().positive().nullable(),
    needsTransfer: z.boolean(),
    nextChunk: z.number().int().nonnegative(),
    phase: z.enum([
      "claimed",
      "source-prepared",
      "candidate-created",
      "candidate-verified",
      "source-retired",
      "candidate-promoted",
      "switched",
      "completed",
    ]),
    releaseSha: z.string().regex(SNAPSHOT_RELEASE_SHA_PATTERN),
    sandboxName: z.string().min(1).max(100),
    sourceId: z.string().min(1).max(500),
    sourceSnapshot: z.string().min(1).max(500),
    targetSnapshot: z.string().min(1).max(500),
    treeDigest: z.string().regex(DIGEST_PATTERN).nullable(),
    upgradeId: z.string().regex(UPGRADE_ID_PATTERN),
    volumeId: z.string().uuid(),
    volumeName: z.string().min(1).max(100),
  })
  .strict();

export type SnapshotUpgradeState = z.infer<typeof SnapshotUpgradeStateBaseSchema>;
export const SnapshotUpgradeStateSchema =
  SnapshotUpgradeStateBaseSchema.superRefine(validateUpgradeState);

function validateUpgradeState(state: SnapshotUpgradeState, context: z.RefinementCtx): void {
  addStateIssue(context, preparedWithoutDigest(state), "Prepared upgrade has no tree digest.");
  addStateIssue(context, incompleteTransferEvidence(state), "Transfer evidence is incomplete.");
  addStateIssue(context, transferCursorExceeded(state), "Transfer cursor exceeds its chunk count.");
  addStateIssue(
    context,
    mountedUpgradeHasTransferState(state),
    "Mounted-volume upgrade has transfer state.",
  );
  addStateIssue(
    context,
    verifiedCandidateHasMissingChunks(state),
    "Verified candidate has incomplete chunks.",
  );
  addStateIssue(
    context,
    claimedUpgradeHasEvidence(state),
    "Claimed upgrade contains prepared evidence.",
  );
  addStateIssue(
    context,
    candidatePhaseWithoutId(state),
    "Candidate phase has no candidate sandbox.",
  );
}

function addStateIssue(context: z.RefinementCtx, isInvalid: boolean, message: string): void {
  if (isInvalid) context.addIssue({ code: "custom", message });
}

function preparedWithoutDigest(state: SnapshotUpgradeState): boolean {
  return state.phase !== "claimed" && state.treeDigest === null;
}

function incompleteTransferEvidence(state: SnapshotUpgradeState): boolean {
  return (
    state.needsTransfer &&
    state.phase !== "claimed" &&
    (state.archiveDigest === null || state.archiveSize === null || state.chunkCount === null)
  );
}

function transferCursorExceeded(state: SnapshotUpgradeState): boolean {
  return state.needsTransfer && state.chunkCount !== null && state.nextChunk > state.chunkCount;
}

function mountedUpgradeHasTransferState(state: SnapshotUpgradeState): boolean {
  return (
    !state.needsTransfer &&
    (state.archiveDigest !== null ||
      state.archiveSize !== null ||
      state.chunkCount !== null ||
      state.nextChunk !== 0)
  );
}

function verifiedCandidateHasMissingChunks(state: SnapshotUpgradeState): boolean {
  return (
    state.needsTransfer &&
    isCandidateVerifiedPhase(state.phase) &&
    state.nextChunk !== state.chunkCount
  );
}

function claimedUpgradeHasEvidence(state: SnapshotUpgradeState): boolean {
  return (
    state.phase === "claimed" &&
    (state.archiveDigest !== null ||
      state.archiveSize !== null ||
      state.chunkCount !== null ||
      state.nextChunk !== 0 ||
      state.treeDigest !== null)
  );
}

function candidatePhaseWithoutId(state: SnapshotUpgradeState): boolean {
  return state.phase !== "claimed" && state.phase !== "source-prepared" && !state.candidateId;
}

function isCandidateVerifiedPhase(phase: SnapshotUpgradeState["phase"]): boolean {
  return (
    phase === "candidate-verified" ||
    phase === "source-retired" ||
    phase === "candidate-promoted" ||
    phase === "switched" ||
    phase === "completed"
  );
}

export const ArchiveEvidenceSchema = z
  .object({
    archiveDigest: z.string().regex(DIGEST_PATTERN),
    archiveSize: z.number().int().positive(),
    chunkCount: z.number().int().positive(),
    treeDigest: z.string().regex(DIGEST_PATTERN),
  })
  .strict();
export const DigestEvidenceSchema = z
  .object({ treeDigest: z.string().regex(DIGEST_PATTERN) })
  .strict();
export const ChunkEvidenceSchema = z.object({ verified: z.boolean() }).strict();
export const ArchiveVerificationSchema = z
  .object({
    archiveDigest: z.string().regex(DIGEST_PATTERN),
    retryTransfer: z.literal(false),
    treeDigest: z.string().regex(DIGEST_PATTERN),
  })
  .strict();
export const RetryTransferSchema = z
  .object({ reason: z.string().min(1).max(500), retryTransfer: z.literal(true) })
  .strict();
