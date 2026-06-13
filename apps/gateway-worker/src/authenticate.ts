import {
  fetchClerkUserPrimaryEmail,
  fetchClerkUserPrimaryEmailStatus,
  verifyClerkBearerToken,
} from "@cheatcode/auth";
import { createDb, resolveInternalUserId, upsertClerkUser } from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";

/**
 * Narrow env surface the auth helpers depend on. `GatewayEnv` structurally
 * satisfies it, so route handlers keep passing their full `c.env`.
 */
export interface AuthEnv {
  CLERK_JWT_KEY?: WorkerSecret;
  CLERK_SECRET_KEY?: WorkerSecret;
  HYPERDRIVE: Hyperdrive;
}

export async function authenticate(
  request: Request,
  env: AuthEnv,
  ctx: ExecutionContext,
): Promise<UserId> {
  const jwtKey = await readOptionalSecret(env.CLERK_JWT_KEY, "CLERK_JWT_KEY");
  const secretKey = await readOptionalSecret(env.CLERK_SECRET_KEY, "CLERK_SECRET_KEY");
  if (!jwtKey && !secretKey) {
    throw new APIError(503, "unavailable_maintenance", "Clerk verification is not configured", {
      hint: "Set CLERK_JWT_KEY or CLERK_SECRET_KEY in the gateway Worker environment.",
      retriable: false,
    });
  }
  const verificationOptions: { jwtKey?: string; secretKey?: string } = {};
  if (jwtKey) {
    verificationOptions.jwtKey = jwtKey;
  }
  if (secretKey) {
    verificationOptions.secretKey = secretKey;
  }
  const session = await verifyClerkBearerToken(request, verificationOptions);
  const { db, close } = createDb(env.HYPERDRIVE);
  try {
    const userId = await resolveInternalUserId(db, session.clerkUserId);
    if (userId) {
      return userId;
    }
    if (!secretKey) {
      throw new APIError(404, "not_found_user", "Authenticated user is not synced", {
        hint: "Wait for the Clerk user.created webhook to finish, then retry.",
        retriable: true,
      });
    }
    const email = await fetchClerkUserEmail(session.clerkUserId, secretKey);
    if (!email) {
      throw new APIError(404, "not_found_user", "Authenticated user is missing an email", {
        hint: "Add a primary email address to the Clerk user, then retry.",
        retriable: false,
      });
    }
    const syncedUser = await upsertClerkUser(db, { clerkId: session.clerkUserId, email });
    return syncedUser.userId;
  } finally {
    ctx.waitUntil(close());
  }
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
  const session = await verifyClerkBearerToken(request, { secretKey });
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
