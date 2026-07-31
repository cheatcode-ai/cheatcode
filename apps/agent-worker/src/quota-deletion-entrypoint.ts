import { WorkerEntrypoint } from "cloudflare:workers";
import { AgentWorkerEnvSchema } from "@cheatcode/env";
import { toUserId, type UserId } from "@cheatcode/types";
import type { QuotaDeletionServiceBinding } from "@cheatcode/types/quota";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";

const QuotaDeletionCallerSchema = z.strictObject({
  caller: z.literal("webhooks"),
  capability: z.literal("quota-deletion"),
});

const QuotaUserIdSchema = z.string().uuid().transform(toUserId);
type QuotaDeletionCaller = z.infer<typeof QuotaDeletionCallerSchema>;

/**
 * Destructive quota-state capability held only by the account-deletion worker.
 */
export class QuotaDeletionEntrypoint
  extends WorkerEntrypoint<AgentEnv, QuotaDeletionCaller>
  implements QuotaDeletionServiceBinding
{
  public deleteAllState(userId: UserId): Promise<void> {
    AgentWorkerEnvSchema.parse(this.env);
    QuotaDeletionCallerSchema.parse(this.ctx.props);
    const parsedUserId = QuotaUserIdSchema.parse(userId);
    const namespace = this.env.QUOTA_TRACKER;
    return namespace.get(namespace.idFromName(`quota:${parsedUserId}`)).deleteAllState();
  }
}
