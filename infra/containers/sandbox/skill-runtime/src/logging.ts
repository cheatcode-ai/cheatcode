import type { SkillLogger } from "./types";

type SkillLogWriter = Pick<SkillLogger, "log">;

function pluralizeLabel(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}

export function logBlankLine(logger: SkillLogWriter): void {
  logger.log("");
}

export function logPreparedItemCount(params: {
  logger: SkillLogWriter;
  count: number;
  noun: string;
}): void {
  params.logger.log(
    `Prepared ${params.count} ${pluralizeLabel(params.noun, params.count)}.`,
  );
  logBlankLine(params.logger);
}

export function assertItemCount(params: {
  items: readonly unknown[];
  noun: string;
  min?: number;
  max?: number;
  maxContext?: string;
}): void {
  const count = params.items.length;

  if (typeof params.min === "number" && count < params.min) {
    if (params.min === 1) {
      throw new Error(`Provide at least one ${params.noun}.`);
    }

    throw new Error(
      `Provide at least ${params.min} ${pluralizeLabel(params.noun, params.min)}.`,
    );
  }

  if (typeof params.max === "number" && count > params.max) {
    const prefix = params.maxContext?.trim().length
      ? `${params.maxContext.trim()} accepts`
      : "This tool accepts";

    throw new Error(
      `${prefix} at most ${params.max} ${pluralizeLabel(params.noun, params.max)} per request. Split this request with ${count} ${pluralizeLabel(params.noun, count)} into multiple calls.`,
    );
  }
}
