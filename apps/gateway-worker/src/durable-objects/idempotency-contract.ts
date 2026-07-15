import { z } from "zod";

const MAX_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const IdempotencyBeginBodySchema = z
  .object({
    bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    claimId: z.string().uuid(),
    key: z.string().trim().min(1).max(255),
    now: z.number().int().positive(),
    ttlMs: z.number().int().positive().max(MAX_IDEMPOTENCY_TTL_MS),
  })
  .strict();

const CachedResponseSchema = z
  .object({
    body: z.string().nullable(),
    headers: z.array(z.tuple([z.string(), z.string()])),
    status: z.number().int().min(100).max(599),
  })
  .strict();

export const IdempotencyBeginResultSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("proceed"),
    })
    .strict(),
  z
    .object({
      action: z.literal("conflict_in_flight"),
      retryAfterMs: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("replay"),
      response: CachedResponseSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("reused"),
    })
    .strict(),
]);

export const IdempotencyCompleteBodySchema = z
  .object({
    body: z.string().max(65_536).nullable(),
    claimId: z.string().uuid(),
    headers: z.array(z.tuple([z.string(), z.string()])).max(50),
    key: z.string().trim().min(1).max(255),
    now: z.number().int().positive(),
    status: z.number().int().min(100).max(599),
    ttlMs: z.number().int().positive().max(MAX_IDEMPOTENCY_TTL_MS),
  })
  .strict();

export type IdempotencyBeginResult = z.infer<typeof IdempotencyBeginResultSchema>;
