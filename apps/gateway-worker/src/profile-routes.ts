import { updateClerkUserPublicMetadata, verifyClerkBearerToken } from "@cheatcode/auth";
import {
  createDb,
  getUserProfile,
  type UpsertUserProfileInput,
  type UserProfileRecord,
  upsertUserProfile,
  withUserContext,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import {
  APIError,
  createLogger,
  readJsonRequest,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import {
  type UpdateUserProfile,
  UpdateUserProfileSchema,
  type UserId,
  UserProfileSchema,
} from "@cheatcode/types";
import type { z } from "zod";
import { clerkAuthorizedParties, readOptionalClerkSecret } from "./authenticate";
import type { WaitUntilContext } from "./wait-until-context";

export interface ProfileRouteEnv {
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CLERK_AUTHORIZED_PARTIES?: string;
  CLERK_SECRET_KEY?: WorkerSecret;
  DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

const MAX_PROFILE_REQUEST_BYTES = 32 * 1024;

export async function getMyProfileRoute(
  env: ProfileRouteEnv,
  ctx: WaitUntilContext,
  userId: UserId,
): Promise<Response> {
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const record = await withUserContext(db, userId, (tx) => getUserProfile(tx, userId));
    return Response.json(UserProfileSchema.parse(profileResponse(record)));
  } finally {
    ctx.waitUntil(close());
  }
}

export async function updateMyProfileRoute(
  env: ProfileRouteEnv,
  ctx: WaitUntilContext,
  request: Request,
  userId: UserId,
): Promise<Response> {
  const parsed = UpdateUserProfileSchema.safeParse(
    await readJsonRequest(request, MAX_PROFILE_REQUEST_BYTES, "Profile request"),
  );
  if (!parsed.success) {
    throw invalidRequestBody("Invalid profile payload", parsed.error);
  }
  const body = parsed.data;
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  let result: UserProfileRecord;
  try {
    result = await withUserContext(db, userId, (tx) =>
      upsertUserProfile(tx, buildProfilePatch(userId, body)),
    );
  } finally {
    ctx.waitUntil(close());
  }
  if (body.onboardingCompleted === true) {
    await mirrorOnboardingClaim(env, request, userId);
  }
  return Response.json(UserProfileSchema.parse(profileResponse(result)));
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
    const secretKey = await readOptionalClerkSecret(env);
    if (!secretKey) {
      logger.warn("onboarding_claim_mirror_skipped");
      return;
    }
    const session = await verifyClerkBearerToken(request, {
      authorizedParties: clerkAuthorizedParties(env),
      secretKey,
    });
    await updateClerkUserPublicMetadata({
      clerkUserId: session.clerkUserId,
      metadata: { onboarding_complete: true },
      secretKey,
    });
  } catch (error) {
    logger.warn("onboarding_claim_mirror_failed", {
      ...safeErrorTelemetry(error),
    });
  }
}

function profileResponse(record: UserProfileRecord | null): Record<string, unknown> {
  if (!record) {
    return {
      agentDisplayName: null,
      disabledModels: [],
      globalMemory: null,
      onboardingCompletedAt: null,
      onboardingState: { steps: {} },
      updatedAt: null,
    };
  }
  return {
    agentDisplayName: record.agentDisplayName,
    disabledModels: record.disabledModels,
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
