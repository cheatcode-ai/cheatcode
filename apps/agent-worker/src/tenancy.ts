import { APIError } from "@cheatcode/observability";
import { z } from "zod";

export const GatewayUserIdSchema = z.string().uuid();
const ThreadRouteParamSchema = z.string().uuid();
const RunRouteParamSchema = z.string().uuid();

const SANDBOX_ID_PREFIX = "cc";
const SANDBOX_ID_HEX_LENGTH = 40;
const textEncoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readGatewayUserId(headers: Headers): string {
  const parsed = GatewayUserIdSchema.safeParse(headers.get("X-Cheatcode-User-Id"));
  if (!parsed.success) {
    throw new APIError(401, "auth_token_missing", "Missing gateway user header", {
      hint: "Call agent-worker through gateway-worker service binding.",
      retriable: false,
    });
  }
  return parsed.data;
}

export function parseThreadRouteParam(value: string): string {
  const parsed = ThreadRouteParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid thread id", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

export function parseRunRouteParam(value: string): string {
  const parsed = RunRouteParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_path_param", "Invalid run id", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

// One sandbox ("computer") per user: every project is a subfolder under /workspace in the same
// sandbox, so the DO name is keyed only by userId.
export async function userSandboxName(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(JSON.stringify(["user-sandbox", userId])),
  );
  return `${SANDBOX_ID_PREFIX}-${toHex(digest).slice(0, SANDBOX_ID_HEX_LENGTH)}`;
}
