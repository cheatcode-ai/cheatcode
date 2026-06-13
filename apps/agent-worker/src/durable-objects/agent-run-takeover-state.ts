import { APIError } from "@cheatcode/observability";
import type { ResumeTakeoverInput, TakeoverStateInput } from "./agent-run-schemas";
import {
  deleteRunStateValues,
  getRunStateTimestamp,
  getRunStateValue,
  setRunStateValue,
} from "./agent-run-storage";

export function saveTakeoverStateInStorage(
  ctx: DurableObjectState,
  input: TakeoverStateInput,
): void {
  const ownerUserId = getRunStateValue(ctx, "owner_user_id");
  if (ownerUserId && ownerUserId !== input.userId) {
    throw takeoverOwnerMismatchError();
  }
  if (!ownerUserId) {
    setRunStateValue(ctx, "owner_user_id", input.userId);
  }
  setRunStateValue(ctx, "takeover_resume_token", input.resumeToken);
  setRunStateValue(ctx, "takeover_expires_at", String(input.expiresAt));
}

export function consumeTakeoverStateInStorage(
  ctx: DurableObjectState,
  input: ResumeTakeoverInput,
): void {
  const ownerUserId = getRunStateValue(ctx, "owner_user_id");
  if (ownerUserId !== input.userId) {
    throw takeoverOwnerMismatchError();
  }
  const storedToken = getRunStateValue(ctx, "takeover_resume_token");
  const expiresAt = getRunStateTimestamp(ctx, "takeover_expires_at");
  const now = input.now ?? Date.now();
  if (!storedToken || storedToken !== input.resumeToken || !expiresAt || expiresAt < now) {
    throw new APIError(409, "conflict_state_invalid", "Takeover session is not active", {
      hint: "Start a new takeover session before resuming.",
      retriable: false,
    });
  }
  deleteRunStateValues(ctx, ["takeover_resume_token", "takeover_expires_at"]);
}

function takeoverOwnerMismatchError(): APIError {
  return new APIError(403, "permission_denied", "Run ownership mismatch", {
    hint: "Open the thread from the account that started the run.",
    retriable: false,
  });
}
