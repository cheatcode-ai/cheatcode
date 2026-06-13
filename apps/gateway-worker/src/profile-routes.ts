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
import { APIError, createLogger } from "@cheatcode/observability";
import {
  type CatalogModelId,
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
    const record = await withUserContext(db, userId, (tx) => getUserProfile(tx, userId));
    return Response.json(UserProfileSchema.parse(profileResponse(record)));
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
  let record: UserProfileRecord;
  try {
    record = await withUserContext(db, userId, async (tx) => {
      const existing = await getUserProfile(tx, userId);
      return upsertUserProfile(tx, buildProfilePatch(userId, body, existing));
    });
  } finally {
    ctx.waitUntil(close());
  }
  if (body.onboardingCompleted === true) {
    await mirrorOnboardingClaim(env, request, userId);
  }
  return Response.json(UserProfileSchema.parse(profileResponse(record)));
}

function buildProfilePatch(
  userId: UserId,
  body: UpdateUserProfile,
  existing: UserProfileRecord | null,
): UpsertUserProfileInput {
  const nextDisabled = resolveDisabledSet(body, existing);
  const input: UpsertUserProfileInput = { userId };
  assignScalarFields(input, body);
  applySurfaceModel(input, "appbuilder", body.appbuilderDefaultModel, existing, nextDisabled);
  applySurfaceModel(input, "general", body.generalDefaultModel, existing, nextDisabled);
  if (body.disabledModels !== undefined) {
    input.disabledModels = [...nextDisabled];
  }
  return input;
}

function resolveDisabledSet(
  body: UpdateUserProfile,
  existing: UserProfileRecord | null,
): ReadonlySet<string> {
  return new Set(body.disabledModels ?? existing?.disabledModels ?? []);
}

function assignScalarFields(input: UpsertUserProfileInput, body: UpdateUserProfile): void {
  if (body.agentDisplayName !== undefined) {
    input.agentDisplayName = body.agentDisplayName;
  }
  if (body.globalMemory !== undefined) {
    input.globalMemory = body.globalMemory;
  }
  if (body.appbuilderDefaultBudgetUsd !== undefined) {
    input.appbuilderDefaultBudgetUsd = body.appbuilderDefaultBudgetUsd;
  }
  if (body.generalDefaultBudgetUsd !== undefined) {
    input.generalDefaultBudgetUsd = body.generalDefaultBudgetUsd;
  }
  if (body.onboardingCompleted !== undefined) {
    input.onboardingCompleted = body.onboardingCompleted;
  }
  if (body.onboardingStep !== undefined) {
    input.onboardingStep = body.onboardingStep;
  }
}

/**
 * Enforce "a disabled model cannot be a per-surface default": reject when the
 * request sets a disabled model as the default, and clear a stored default that
 * the request newly disables.
 */
function applySurfaceModel(
  input: UpsertUserProfileInput,
  surface: "appbuilder" | "general",
  bodyValue: CatalogModelId | null | undefined,
  existing: UserProfileRecord | null,
  nextDisabled: ReadonlySet<string>,
): void {
  const key = surface === "appbuilder" ? "appbuilderDefaultModel" : "generalDefaultModel";
  if (bodyValue !== undefined) {
    if (bodyValue !== null && nextDisabled.has(bodyValue)) {
      throw disabledDefaultConflict(surface, bodyValue);
    }
    input[key] = bodyValue;
    return;
  }
  const storedValue = existing?.[key] ?? null;
  if (storedValue !== null && nextDisabled.has(storedValue)) {
    input[key] = null;
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

function profileResponse(record: UserProfileRecord | null): Record<string, unknown> {
  if (!record) {
    return {
      agentDisplayName: null,
      appbuilderDefaultBudgetUsd: null,
      appbuilderDefaultModel: null,
      disabledModels: [],
      generalDefaultBudgetUsd: null,
      generalDefaultModel: null,
      globalMemory: null,
      onboardingCompletedAt: null,
      onboardingState: { steps: {} },
      updatedAt: null,
    };
  }
  return {
    agentDisplayName: record.agentDisplayName,
    appbuilderDefaultBudgetUsd: coerceBudget(record.appbuilderDefaultBudgetUsd),
    appbuilderDefaultModel: record.appbuilderDefaultModel,
    disabledModels: record.disabledModels,
    generalDefaultBudgetUsd: coerceBudget(record.generalDefaultBudgetUsd),
    generalDefaultModel: record.generalDefaultModel,
    globalMemory: record.globalMemory,
    onboardingCompletedAt: record.onboardingCompletedAt?.toISOString() ?? null,
    onboardingState: record.onboardingState,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function coerceBudget(value: number | null): number | null {
  return value === null ? null : Number(value);
}

function disabledDefaultConflict(surface: string, model: string): APIError {
  return new APIError(
    400,
    "invalid_request_body",
    "A disabled model cannot be set as a per-surface default.",
    {
      details: { model, surface },
      hint: "Re-enable the model or choose a different default for this surface.",
      retriable: false,
    },
  );
}

function invalidRequestBody(message: string, error: z.ZodError): APIError {
  return new APIError(400, "invalid_request_body", message, {
    details: { issues: error.issues.map((issue) => issue.message) },
    retriable: false,
  });
}
