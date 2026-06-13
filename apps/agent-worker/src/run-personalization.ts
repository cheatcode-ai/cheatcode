import { type Database, getRunPersonalization, type RunPersonalization } from "@cheatcode/db";
import { APIError } from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";

/**
 * Loads the user's run personalization on the run-create hot path and enforces the
 * explicit-model gate: an explicitly requested model that the user has turned off in
 * their Models settings is rejected synchronously with a 400.
 *
 * Runs inside the caller's already-open Hyperdrive transaction (one extra indexed PK select).
 */
export async function loadRunPersonalization(
  tx: Database,
  userId: UserId,
  requestedModel: string | undefined,
): Promise<RunPersonalization> {
  const personalization = await getRunPersonalization(tx, userId);
  if (requestedModel && personalization.disabledModels.includes(requestedModel)) {
    throw new APIError(
      400,
      "validation_model_unavailable",
      "This model is turned off in your Models settings.",
      {
        details: { model: requestedModel },
        hint: "Re-enable it under Settings → Agents, or pick another model.",
        retriable: false,
      },
    );
  }
  return personalization;
}
