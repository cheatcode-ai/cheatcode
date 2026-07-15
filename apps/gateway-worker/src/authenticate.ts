import {
  fetchClerkUserPrimaryEmail,
  fetchClerkUserPrimaryEmailStatus,
  verifyClerkBearerToken,
} from "@cheatcode/auth";
import {
  createDb,
  type Database,
  resolveInternalUserId,
  UserDeletionBlockedError,
  upsertClerkUser,
} from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import type { WaitUntilContext } from "./wait-until-context";

/**
 * Narrow env surface the auth helpers depend on. `GatewayEnv` structurally
 * satisfies it, so route handlers keep passing their full `c.env`.
 */
export interface AuthEnv {
  CHEATCODE_ENVIRONMENT: "development" | "production";
  CLERK_AUTHORIZED_PARTIES?: string;
  CLERK_JWT_KEY?: WorkerSecret;
  CLERK_SECRET_KEY?: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

export async function authenticate(
  request: Request,
  env: AuthEnv,
  ctx: WaitUntilContext,
): Promise<UserId> {
  const { secretKey, verificationOptions } = await clerkVerification(env);
  const session = await verifyClerkBearerToken(request, verificationOptions);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    return await resolveOrSyncClerkUser(db, session.clerkUserId, secretKey);
  } finally {
    ctx.waitUntil(close());
  }
}

async function clerkVerification(env: AuthEnv) {
  const jwtKey = await readOptionalSecret(env.CLERK_JWT_KEY, "CLERK_JWT_KEY");
  const secretKey = await readOptionalSecret(env.CLERK_SECRET_KEY, "CLERK_SECRET_KEY");
  if (!jwtKey && !secretKey) {
    throw new APIError(503, "unavailable_maintenance", "Clerk verification is not configured", {
      hint: "Set CLERK_JWT_KEY or CLERK_SECRET_KEY in the gateway Worker environment.",
      retriable: false,
    });
  }
  const verificationOptions: {
    authorizedParties: string[];
    jwtKey?: string;
    secretKey?: string;
  } = { authorizedParties: clerkAuthorizedParties(env) };
  if (jwtKey) {
    verificationOptions.jwtKey = jwtKey;
  }
  if (secretKey) {
    verificationOptions.secretKey = secretKey;
  }
  return { secretKey, verificationOptions };
}

async function resolveOrSyncClerkUser(
  db: Database,
  clerkUserId: string,
  secretKey: string | undefined,
): Promise<UserId> {
  const userId = await resolveInternalUserId(db, clerkUserId);
  if (userId) {
    return userId;
  }
  if (!secretKey) {
    throw new APIError(404, "not_found_user", "Authenticated user is not synced", {
      hint: "Wait for the Clerk user.created webhook to finish, then retry.",
      retriable: true,
    });
  }
  const email = await fetchClerkUserEmail(clerkUserId, secretKey);
  if (!email) {
    throw new APIError(404, "not_found_user", "Authenticated user is missing an email", {
      hint: "Add a primary email address to the Clerk user, then retry.",
      retriable: false,
    });
  }
  try {
    return (await upsertClerkUser(db, { clerkId: clerkUserId, email })).userId;
  } catch (error) {
    throw mapClerkSyncError(error);
  }
}

function mapClerkSyncError(error: unknown): unknown {
  if (!(error instanceof UserDeletionBlockedError)) {
    return error;
  }
  if (error.reason === "completed") {
    return new APIError(409, "conflict_state_invalid", "Account identity was deleted", {
      hint: "Sign out and create a new Clerk account before returning to Cheatcode.",
      retriable: false,
    });
  }
  return new APIError(409, "conflict_in_flight", "Account deletion is in progress", {
    hint: "Wait for deletion to finish before creating a new account.",
    retriable: true,
  });
}

async function fetchClerkUserEmail(clerkUserId: string, secretKey: string): Promise<string | null> {
  try {
    return await fetchClerkUserPrimaryEmail({ clerkUserId, secretKey });
  } catch {
    throw new APIError(503, "unavailable_maintenance", "Unable to sync Clerk user", {
      hint: "Verify CLERK_SECRET_KEY and Clerk Backend API availability.",
      retriable: true,
    });
  }
}

export async function requireVerifiedClerkEmail(request: Request, env: AuthEnv): Promise<void> {
  const secretKey = await readRequiredSecret(env.CLERK_SECRET_KEY, "CLERK_SECRET_KEY");
  const session = await verifyClerkBearerToken(request, {
    authorizedParties: clerkAuthorizedParties(env),
    secretKey,
  });
  const emailStatus = await fetchClerkEmailStatus(session.clerkUserId, secretKey);
  if (emailStatus.verified) {
    return;
  }
  throw new APIError(403, "permission_denied", "Verify your email before starting a sandbox run", {
    details: { email: emailStatus.email },
    hint: "Complete Clerk email verification, refresh the app, and start the run again.",
    retriable: false,
  });
}

export function clerkAuthorizedParties(
  env: Pick<AuthEnv, "CHEATCODE_ENVIRONMENT" | "CLERK_AUTHORIZED_PARTIES">,
): string[] {
  const configured = env.CLERK_AUTHORIZED_PARTIES?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const parties =
    configured && configured.length > 0
      ? configured
      : env.CHEATCODE_ENVIRONMENT === "production"
        ? ["https://trycheatcode.com"]
        : ["http://localhost:3000", "http://127.0.0.1:3000"];
  if (parties.length > 16 || parties.some((value) => !isExactHttpOrigin(value))) {
    throw new APIError(503, "unavailable_maintenance", "Clerk authorized parties are invalid", {
      hint: "Configure CLERK_AUTHORIZED_PARTIES as comma-separated exact HTTP(S) origins.",
      retriable: false,
    });
  }
  return [...new Set(parties)];
}

function isExactHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === value &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

async function fetchClerkEmailStatus(clerkUserId: string, secretKey: string) {
  try {
    return await fetchClerkUserPrimaryEmailStatus({ clerkUserId, secretKey });
  } catch {
    throw new APIError(503, "unavailable_maintenance", "Unable to verify Clerk email status", {
      hint: "Verify CLERK_SECRET_KEY and Clerk Backend API availability.",
      retriable: true,
    });
  }
}

export async function readOptionalSecret(
  secret: WorkerSecret | undefined,
  name: string,
): Promise<string | undefined> {
  try {
    return await resolveWorkerSecret(secret);
  } catch {
    throw new APIError(503, "unavailable_maintenance", `${name} is unavailable`, {
      hint: `Verify the ${name} Cloudflare Secrets Store binding and secret value.`,
      retriable: false,
    });
  }
}

export async function readRequiredSecret(
  secret: WorkerSecret | undefined,
  name: string,
): Promise<string> {
  const value = await readOptionalSecret(secret, name);
  if (!value) {
    throw new APIError(503, "unavailable_maintenance", `${name} is not configured`, {
      hint: `Set ${name} in the gateway Worker environment.`,
      retriable: false,
    });
  }
  return value;
}
