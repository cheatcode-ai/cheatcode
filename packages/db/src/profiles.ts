import type { UserId } from "@cheatcode/types";
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import type { OnboardingStateValue } from "./schema";
import { userProfiles } from "./schema";

export type UserProfileRecord = typeof userProfiles.$inferSelect;

type OnboardingStepKey = "intro" | "name" | "tools" | "basics" | "plan";
type OnboardingStepStatusValue = "done" | "skipped";

export interface UpsertUserProfileInput {
  userId: UserId;
  agentDisplayName?: string | null;
  disabledModels?: readonly string[];
  globalMemory?: string | null;
  onboardingCompleted?: boolean;
  onboardingStep?: { status: OnboardingStepStatusValue; step: OnboardingStepKey };
}

export interface RunPersonalization {
  agentDisplayName: string | null;
  disabledModels: readonly string[];
  globalMemory: string | null;
}

const DEFAULT_PERSONALIZATION: RunPersonalization = {
  agentDisplayName: null,
  disabledModels: [],
  globalMemory: null,
};

export async function getUserProfile(
  db: Database,
  userId: UserId,
): Promise<UserProfileRecord | null> {
  const row = await db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, userId) });
  return row ?? null;
}

/** Narrow read for the run-create hot path; missing row → all defaults. */
export async function getRunPersonalization(
  db: Database,
  userId: UserId,
): Promise<RunPersonalization> {
  const row = await db.query.userProfiles.findFirst({
    columns: {
      agentDisplayName: true,
      disabledModels: true,
      globalMemory: true,
    },
    where: eq(userProfiles.userId, userId),
  });
  if (!row) {
    return DEFAULT_PERSONALIZATION;
  }
  return {
    agentDisplayName: row.agentDisplayName,
    disabledModels: row.disabledModels,
    globalMemory: row.globalMemory,
  };
}

export async function upsertUserProfile(
  db: Database,
  input: UpsertUserProfileInput,
): Promise<UserProfileRecord> {
  const existing = await getUserProfile(db, input.userId);
  const onboardingState = mergeOnboardingState(existing?.onboardingState, input.onboardingStep);
  const shouldLatch =
    input.onboardingCompleted === true && (existing?.onboardingCompletedAt ?? null) === null;
  const mutation = {
    ...profileColumnUpdates(input),
    onboardingState,
    ...(shouldLatch ? { onboardingCompletedAt: new Date() } : {}),
  };
  // updated_at is refreshed by the trg_v2_user_profiles_updated BEFORE UPDATE trigger.
  const [row] = await db
    .insert(userProfiles)
    .values({ userId: input.userId, ...mutation })
    .onConflictDoUpdate({ set: mutation, target: userProfiles.userId })
    .returning();
  if (!row) {
    throw new Error("Failed to upsert user profile.");
  }
  return row;
}

function profileColumnUpdates(
  input: UpsertUserProfileInput,
): Partial<typeof userProfiles.$inferInsert> {
  const updates: Partial<typeof userProfiles.$inferInsert> = {};
  if (input.agentDisplayName !== undefined) {
    updates.agentDisplayName = input.agentDisplayName;
  }
  if (input.globalMemory !== undefined) {
    updates.globalMemory = input.globalMemory;
  }
  if (input.disabledModels !== undefined) {
    updates.disabledModels = [...input.disabledModels];
  }
  return updates;
}

function mergeOnboardingState(
  existing: OnboardingStateValue | undefined,
  step: UpsertUserProfileInput["onboardingStep"],
): OnboardingStateValue {
  const steps = { ...(existing?.steps ?? {}) };
  if (step) {
    steps[step.step] = step.status;
  }
  return { steps };
}
