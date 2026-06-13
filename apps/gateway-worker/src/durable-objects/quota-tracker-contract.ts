import { z } from "zod";

export const QuotaFeatureSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_.-]*$/);

export const QuotaPeriodEndSchema = z.string().datetime();

export const QuotaLimitSchema = z.number().finite().nonnegative();

export const QuotaConsumeBodySchema = z
  .object({
    amount: z.number().finite().positive(),
    feature: QuotaFeatureSchema,
    periodEnd: QuotaPeriodEndSchema,
  })
  .strict();

export const QuotaRecordBodySchema = QuotaConsumeBodySchema;

export const QuotaPeekBodySchema = z
  .object({
    feature: QuotaFeatureSchema,
    periodEnd: QuotaPeriodEndSchema,
  })
  .strict();

export const QuotaSetLimitBodySchema = z
  .object({
    feature: QuotaFeatureSchema,
    limit: QuotaLimitSchema,
    source: z.string().trim().min(1).max(120),
  })
  .strict();

export const QuotaSnapshotBodySchema = z
  .object({
    periodEnd: QuotaPeriodEndSchema,
  })
  .strict();

export const QuotaResetBodySchema = z
  .object({
    feature: QuotaFeatureSchema,
  })
  .strict();

export const QuotaConsumeResultSchema = z
  .object({
    allowed: z.boolean(),
    limit: QuotaLimitSchema,
    remaining: z.number().finite().nonnegative(),
  })
  .strict();

export const QuotaPeekResultSchema = z
  .object({
    limit: QuotaLimitSchema,
    remaining: z.number().finite().nonnegative(),
    used: z.number().finite().nonnegative(),
  })
  .strict();

export const QuotaSnapshotResultSchema = z.record(
  QuotaFeatureSchema,
  z
    .object({
      limit: QuotaLimitSchema,
      used: z.number().finite().nonnegative(),
    })
    .strict(),
);

export type QuotaConsumeResult = z.infer<typeof QuotaConsumeResultSchema>;
export type QuotaPeekResult = z.infer<typeof QuotaPeekResultSchema>;
export type QuotaRecordBody = z.infer<typeof QuotaRecordBodySchema>;
export type QuotaSnapshotResult = z.infer<typeof QuotaSnapshotResultSchema>;
