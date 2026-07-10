import { updateClerkUserPublicMetadata, verifyClerkBearerToken } from "@cheatcode/auth";
import {
  createDb,
  type FreeDeepseekUsage,
  getFreeDeepseekUsage,
  getUserProfile,
  type UpsertUserProfileInput,
  type UserProfileRecord,
  upsertUserProfile,
  withUserContext,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import { APIError, createLogger } from "@cheatcode/observability";
import {
  type UpdateUserProfile,
  UpdateUserProfileSchema,
  type UserId,
  UserProfileSchema,
} from "@cheatcode/types";
import type { z } from "zod";
import { readOptionalSecret } from "./authenticate";

export interface ProfileRouteEnv {
  CLERK_SECRET_KEY?: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

export async function getMyProfileRoute(
  env: ProfileRouteEnv,
  ctx: ExecutionContext,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const { freeDeepseek, record } = await withUserContext(db, userId, async (tx) => ({
      freeDeepseek: await getFreeDeepseekUsage(tx, userId),
      record: await getUserProfile(tx, userId),
    }));
    return Response.json(UserProfileSchema.parse(profileResponse(record, freeDeepseek)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function updateMyProfileRoute(
  env: ProfileRouteEnv,
  ctx: ExecutionContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const parsed = UpdateUserProfileSchema.safeParse(await request.json());
  if (!parsed.success) {
    throw invalidRequestBody("Invalid profile payload", parsed.error);
  }
  const body = parsed.data;
  const { db, close } = createDb(env.HYPERDRIVE);
  let result: { freeDeepseek: FreeDeepseekUsage; record: UserProfileRecord };
  try {
    result = await withUserContext(db, userId, async (tx) => ({
      freeDeepseek: await getFreeDeepseekUsage(tx, userId),
      record: await upsertUserProfile(tx, buildProfilePatch(userId, body)),
    }));
  } finally {
    ctx.waitUntil(close());
  }
  if (body.onboardingCompleted === true) {
    await mirrorOnboardingClaim(env, request, userId);
  }
  return Response.json(
    UserProfileSchema.parse(profileResponse(result.record, result.freeDeepseek)),
  );
}

function buildProfilePatch(userId: UserId, body: UpdateUserProfile): UpsertUserProfileInput {
  const input: UpsertUserProfileInput = { userId };
  assignScalarFields(input, body);
  if (body.disabledModels !== undefined) {
    input.disabledModels = [...body.disabledModels];
  }
  return input;
}

function assignScalarFields(input: UpsertUserProfileInput, body: UpdateUserProfile): void {
  if (body.agentDisplayName !== undefined) {
    input.agentDisplayName = body.agentDisplayName;
  }
  if (body.globalMemory !== undefined) {
    input.globalMemory = body.globalMemory;
  }
  if (body.onboardingCompleted !== undefined) {
    input.onboardingCompleted = body.onboardingCompleted;
  }
  if (body.onboardingStep !== undefined) {
    input.onboardingStep = body.onboardingStep;
  }
}

async function mirrorOnboardingClaim(
  env: ProfileRouteEnv,
  request: Request,
  userId: UserId,
): Promise<void> {
  const logger = createLogger({ userId });
  try {
    const secretKey = await readOptionalSecret(env.CLERK_SECRET_KEY, "CLERK_SECRET_KEY");
    if (!secretKey) {
      logger.warn("onboarding_claim_mirror_skipped");
      return;
    }
    const session = await verifyClerkBearerToken(request, { secretKey });
    await updateClerkUserPublicMetadata({
      clerkUserId: session.clerkUserId,
      metadata: { onboarding_complete: true },
      secretKey,
    });
  } catch (error) {
    logger.warn("onboarding_claim_mirror_failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function profileResponse(
  record: UserProfileRecord | null,
  freeDeepseek: FreeDeepseekUsage,
): Record<string, unknown> {
  if (!record) {
    return {
      agentDisplayName: null,
      disabledModels: [],
      freeDeepseek,
      globalMemory: null,
      onboardingCompletedAt: null,
      onboardingState: { steps: {} },
      updatedAt: null,
    };
  }
  return {
    agentDisplayName: record.agentDisplayName,
    disabledModels: record.disabledModels,
    freeDeepseek,
    globalMemory: record.globalMemory,
    onboardingCompletedAt: record.onboardingCompletedAt?.toISOString() ?? null,
    onboardingState: record.onboardingState,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function invalidRequestBody(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_request_body", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
