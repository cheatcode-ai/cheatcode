import { updateClerkUserPublicMetadata, verifyClerkBearerToken } from "@cheatcode/auth";
import {
  type DatabaseHandle,
  getUserProfile,
  type UpsertUserProfileInput,
  type UserProfileRecord,
  upsertUserProfile,
  withUserDb,
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
  database: DatabaseHandle,
  _ctx: WaitUntilContext,
  userId: UserId,
): Promise<Response> {
  return withUserDb(database, userId, async ({ transaction }) => {
    const record = await transaction((tx) => getUserProfile(tx, userId));
    return Response.json(UserProfileSchema.parse(profileResponse(record)));
  });
}

export async function updateMyProfileRoute(
  database: DatabaseHandle,
  env: ProfileRouteEnv,
  _ctx: WaitUntilContext,
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
  const result = await withUserDb(database, userId, ({ transaction }) =>
    transaction((tx) => upsertUserProfile(tx, buildProfilePatch(userId, body))),
  );
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
  return new APIError(400, "request_body_invalid", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
