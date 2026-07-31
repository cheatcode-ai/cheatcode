import { WorkerEntrypoint } from "cloudflare:workers";
import { AgentWorkerEnvSchema } from "@cheatcode/env";
import { toUserId, type UserId } from "@cheatcode/types";
import type {
  GatewayQuotaServiceBinding,
  QuotaFeature,
  QuotaHistoryResult,
  QuotaUsageResponse,
} from "@cheatcode/types/quota";
import { z } from "zod";
import type { AgentEnv } from "./agent-env";
import type { QuotaTrackerStub } from "./quota-tracker-binding";

const GatewayQuotaCallerSchema = z.strictObject({
  caller: z.literal("gateway"),
  capability: z.literal("gateway-quota"),
});

const QuotaUserIdSchema = z.string().uuid().transform(toUserId);
type GatewayQuotaCaller = z.infer<typeof GatewayQuotaCallerSchema>;

/** Quota operations used by gateway usage, activity, and limit-sync routes. */
export class GatewayQuotaEntrypoint
  extends WorkerEntrypoint<AgentEnv, GatewayQuotaCaller>
  implements GatewayQuotaServiceBinding
{
  public history(userId: UserId, feature: QuotaFeature, from: Date): Promise<QuotaHistoryResult> {
    return gatewayQuotaStub(this.env, this.ctx.props, userId).history(feature, from);
  }

  public peek(userId: UserId, feature: QuotaFeature, periodEnd: Date): Promise<QuotaUsageResponse> {
    return gatewayQuotaStub(this.env, this.ctx.props, userId).peek(feature, periodEnd);
  }

  public setLimit(
    userId: UserId,
    feature: QuotaFeature,
    limit: number,
    entitlementVersion: number,
  ): Promise<void> {
    return gatewayQuotaStub(this.env, this.ctx.props, userId).setLimit(
      feature,
      limit,
      entitlementVersion,
    );
  }
}

function gatewayQuotaStub(
  env: AgentEnv,
  props: GatewayQuotaCaller,
  userId: UserId,
): QuotaTrackerStub {
  AgentWorkerEnvSchema.parse(env);
  GatewayQuotaCallerSchema.parse(props);
  const parsedUserId = QuotaUserIdSchema.parse(userId);
  return env.QUOTA_TRACKER.get(env.QUOTA_TRACKER.idFromName(`quota:${parsedUserId}`));
}
