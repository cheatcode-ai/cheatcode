import { QuotaFeatureSchema, QuotaLimitSchema, QuotaPeriodEndSchema } from "@cheatcode/types/quota";
import { z } from "zod";

export const QuotaHistoryBodySchema = z
  .object({ feature: QuotaFeatureSchema, from: z.string().datetime() })
  .strict();

export const QuotaSnapshotBodySchema = z
  .object({
    periodEnd: QuotaPeriodEndSchema,
  })
  .strict();

export const QuotaSnapshotResultSchema = z.partialRecord(
  QuotaFeatureSchema,
  z
    .object({
      limit: QuotaLimitSchema,
      used: z.number().finite().nonnegative(),
    })
    .strict(),
);

export const QuotaHistoryResultSchema = z.array(
  z.object({ amount: z.number().positive(), recordedAt: z.number().int().nonnegative() }).strict(),
);

export type QuotaHistoryResult = z.infer<typeof QuotaHistoryResultSchema>;
export type QuotaSnapshotResult = z.infer<typeof QuotaSnapshotResultSchema>;
