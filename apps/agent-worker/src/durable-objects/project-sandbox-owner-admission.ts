import { isUserAccountActive, withUserDb } from "@cheatcode/db";
import { toUserId } from "@cheatcode/types";
import {
  accountSandboxDeletedError,
  type ProjectSandboxEnv,
} from "./project-sandbox-lifecycle-support";

/** Refuses to materialize a fresh user sandbox for a deleted or unknown account. */
export async function assertProjectSandboxOwnerActive(
  env: ProjectSandboxEnv,
  userId: string,
): Promise<void> {
  const parsedUserId = toUserId(userId);
  return withUserDb(env, parsedUserId, async ({ transaction }) => {
    const isActive = await transaction((transaction) =>
      isUserAccountActive(transaction, parsedUserId),
    );
    if (!isActive) {
      throw accountSandboxDeletedError();
    }
  });
}
