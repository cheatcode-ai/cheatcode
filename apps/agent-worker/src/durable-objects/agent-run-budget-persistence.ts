import { emitCostEvent } from "@cheatcode/observability";
import type { AgentRunEnv } from "./agent-run-env";
import { estimateTokenUsageUsd } from "./agent-run-pricing";
import type { StartRunInput } from "./agent-run-schemas";
import { persistAgentRunUsage } from "./agent-run-status-persistence";
import {
  appendBudgetEvent,
  readStoredRunSnapshot,
  type StoredBudgetSnapshot,
} from "./agent-run-storage";

export interface BudgetDelta {
  kind: string;
  tokensIn: number;
  tokensOut: number;
  usd: number;
}

export const ZERO_BUDGET_SNAPSHOT: StoredBudgetSnapshot = {
  capUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  usdSpent: 0,
};

export async function recordBudgetDelta(
  ctx: DurableObjectState,
  env: AgentRunEnv,
  input: StartRunInput,
  event: BudgetDelta,
): Promise<StoredBudgetSnapshot> {
  const storedBeforeAppend = readStoredRunSnapshot(ctx);
  const model = input.model ?? storedBeforeAppend?.modelId ?? "unknown";
  const usd = await budgetEventUsd(model, event);
  appendBudgetEvent(ctx, {
    kind: event.kind,
    modelId: model,
    tokensIn: event.tokensIn,
    tokensOut: event.tokensOut,
    usd,
  });
  const stored = readStoredRunSnapshot(ctx);
  const provider = providerFromModel(model);
  ctx.waitUntil(
    persistAgentRunUsage(env, {
      costUsd: usd,
      eventType: event.kind,
      inputTokens: event.tokensIn,
      model,
      outputTokens: event.tokensOut,
      ...(provider ? { provider } : {}),
      runId: input.runId,
      userId: input.userId,
    }),
  );
  emitCostEvent(env, {
    day: new Date().toISOString().slice(0, 10),
    model,
    runId: input.runId,
    tokensIn: event.tokensIn,
    tokensOut: event.tokensOut,
    usdMicros: Math.round(usd * 1_000_000),
    userId: input.userId,
  });
  return stored?.budget ?? ZERO_BUDGET_SNAPSHOT;
}

async function budgetEventUsd(model: string, event: BudgetDelta): Promise<number> {
  if (event.kind !== "llm_usage" || event.usd !== 0) {
    return event.usd;
  }
  return estimateTokenUsageUsd({
    modelId: model,
    tokensIn: event.tokensIn,
    tokensOut: event.tokensOut,
  });
}

function providerFromModel(model: string): "anthropic" | "openai" | undefined {
  if (model.startsWith("anthropic/") || model.startsWith("claude-")) {
    return "anthropic";
  }
  if (model.startsWith("openai/") || model.startsWith("gpt-") || model.startsWith("o")) {
    return "openai";
  }
  return undefined;
}
