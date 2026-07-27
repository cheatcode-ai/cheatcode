import type { AgentRunId, UserId } from "@cheatcode/types";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./client";
import { agentRuns, projects, type StoredSkillRuntimeCapability, threads } from "./schema";

const MAX_STORED_CAPABILITIES_PER_RUN = 12;
const SkillRuntimeScopeSchema = z.enum([
  "events:write",
  "integrations:execute",
  "skills:read",
  "skills:write",
]);
const StoredSkillRuntimeCapabilitySchema = z
  .object({
    digest: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    expiresAt: z.number().int().positive().safe(),
    issuedAt: z.number().int().positive().safe(),
    projectId: z.string().uuid().nullable(),
    scope: SkillRuntimeScopeSchema,
    tokenId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  })
  .strict()
  .refine((value) => value.expiresAt > value.issuedAt, {
    message: "Capability expiration must follow issuance",
  });
const StoredSkillRuntimeCapabilitiesSchema = z
  .array(StoredSkillRuntimeCapabilitySchema)
  .max(MAX_STORED_CAPABILITIES_PER_RUN);

export interface SkillRuntimeCapabilityAuthorization {
  capability: StoredSkillRuntimeCapability;
  projectId: string | null;
  status: "pending" | "running";
}

/** Rotates independently scoped tokens while retaining only the short overlap window. */
export async function rotateSkillRuntimeCapabilities(
  db: Database,
  input: {
    capabilities: StoredSkillRuntimeCapability[];
    now: number;
    runId: AgentRunId;
    userId: UserId;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({
        capabilities: agentRuns.skillRuntimeCapabilities,
        status: agentRuns.status,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.userId, input.userId)))
      .for("update")
      .limit(1);
    if (!run || !["pending", "running"].includes(run.status)) {
      return false;
    }
    const retained = StoredSkillRuntimeCapabilitiesSchema.parse(run.capabilities).filter(
      (capability) => capability.expiresAt > input.now,
    );
    const capabilities = StoredSkillRuntimeCapabilitiesSchema.parse([
      ...retained,
      ...input.capabilities,
    ]).slice(-MAX_STORED_CAPABILITIES_PER_RUN);
    const [updated] = await tx
      .update(agentRuns)
      .set({ skillRuntimeCapabilities: capabilities })
      .where(
        and(
          eq(agentRuns.id, input.runId),
          eq(agentRuns.userId, input.userId),
          inArray(agentRuns.status, ["pending", "running"]),
        ),
      )
      .returning({ id: agentRuns.id });
    return Boolean(updated);
  });
}

/** Loads one capability under the user-scoped RLS context and confirms the run is active. */
export async function authorizeSkillRuntimeCapability(
  db: Database,
  input: {
    requiredScope: StoredSkillRuntimeCapability["scope"];
    runId: AgentRunId;
    tokenId: string;
    userId: UserId;
  },
): Promise<SkillRuntimeCapabilityAuthorization | null> {
  const [run] = await db
    .select({
      capabilities: agentRuns.skillRuntimeCapabilities,
      projectId: projects.id,
      status: agentRuns.status,
    })
    .from(agentRuns)
    .innerJoin(threads, and(eq(threads.id, agentRuns.threadId), eq(threads.userId, input.userId)))
    .leftJoin(
      projects,
      and(
        eq(projects.id, threads.projectId),
        eq(projects.userId, input.userId),
        isNull(projects.deletedAt),
      ),
    )
    .where(
      and(
        eq(agentRuns.id, input.runId),
        eq(agentRuns.userId, input.userId),
        inArray(agentRuns.status, ["pending", "running"]),
        isNull(threads.deletedAt),
      ),
    )
    .limit(1);
  if (!run || (run.status !== "pending" && run.status !== "running")) {
    return null;
  }
  const capability = StoredSkillRuntimeCapabilitiesSchema.parse(run.capabilities).find(
    (candidate) =>
      candidate.tokenId === input.tokenId &&
      candidate.scope === input.requiredScope &&
      candidate.projectId === (run.projectId ?? null),
  );
  return capability
    ? {
        capability,
        projectId: run.projectId ?? null,
        status: run.status,
      }
    : null;
}
