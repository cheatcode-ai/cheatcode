import { createDb, isUserAccountActive, withUserContext } from "@cheatcode/db";
import { UserId } from "@cheatcode/types";
import {
  accountSandboxDeletedError,
  type ProjectSandboxEnv,
} from "./project-sandbox-lifecycle-support";

/** Refuses to materialize a fresh user sandbox for a deleted or unknown account. */
export async function assertProjectSandboxOwnerActive(
  env: ProjectSandboxEnv,
  userId: string,
): Promise<void> {
  const parsedUserId = UserId(userId);
  const { db, close } = createDb(env.HYPERDRIVE, {
    audience: "app_agent",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
  });
  try {
    const isActive = await withUserContext(db, parsedUserId, (transaction) =>
      isUserAccountActive(transaction, parsedUserId),
    );
    if (!isActive) {
      throw accountSandboxDeletedError();
    }
  } finally {
    await close();
  }
}
