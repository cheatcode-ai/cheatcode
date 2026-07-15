import { z } from "zod";
import type { UserId } from "./ids";

const InternalRunIdListSchema = z.array(z.string().uuid()).max(10_000);

export const InternalAgentStateDeleteBodySchema = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("account"),
    })
    .strict(),
  z
    .object({
      scope: z.literal("project"),
      workspaceSlug: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      runIds: InternalRunIdListSchema,
      scope: z.literal("runs"),
    })
    .strict(),
]);

export type InternalAgentStateDeleteBody = z.infer<typeof InternalAgentStateDeleteBodySchema>;

export const InternalGatewayStateDeleteBodySchema = z.object({}).strict();

export const InternalStateDeleteResponseSchema = z.object({ ok: z.literal(true) }).strict();

export type InternalStateDeleteResponse = z.infer<typeof InternalStateDeleteResponseSchema>;

export function internalUserStateDeletePath(userId: UserId): string {
  return `/internal/users/${encodeURIComponent(userId)}/delete-state`;
}
