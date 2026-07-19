import { z } from "zod";

const LastSeqParamSchema = z.coerce.number().int().nonnegative();

export function parseLastSeqParam(value: string | null): number | null {
  if (value === null) {
    return 0;
  }
  const parsed = LastSeqParamSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function hasActiveRun(status: string | undefined): boolean {
  return status === "running";
}
