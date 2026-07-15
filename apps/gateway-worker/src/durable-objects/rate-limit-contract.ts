import { z } from "zod";

const RateLimitConfigSchema = z
  .object({
    capacity: z.number().int().positive(),
    refillPerSec: z.number().positive(),
  })
  .strict();

export const RateLimitConsumeBodySchema = z
  .object({
    key: z.string().min(1),
    cost: z.number().int().positive(),
    config: RateLimitConfigSchema,
  })
  .strict();

export const RateLimitResultSchema = z
  .object({
    allowed: z.boolean(),
    remaining: z.number().int().nonnegative(),
    retryAfterMs: z.number().int().nonnegative(),
  })
  .strict();

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type RateLimitResult = z.infer<typeof RateLimitResultSchema>;
