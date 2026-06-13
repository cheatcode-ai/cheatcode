import { APIError, emitUserEvent } from "@cheatcode/observability";
import type { UIMessageChunk } from "ai";
import {
  budgetCapReachedChunk,
  budgetChunk,
  dailyCostCapReachedChunk,
  isBudgetExhausted,
  isDailyCostCapExhausted,
} from "./agent-run-budget";
import {
  type BudgetDelta,
  recordBudgetDelta as persistBudgetDelta,
  ZERO_BUDGET_SNAPSHOT,
} from "./agent-run-budget-persistence";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import { readStoredRunSnapshot, type StoredBudgetSnapshot } from "./agent-run-storage";

export type CostCapExhaustion = {
  chunk: UIMessageChunk;
  code: "budget_cap_reached" | "daily_cost_cap_reached";
  message: string;
};

/** DO closures the budget/cost-cap accounting helpers need (run-control extraction). */
export interface BudgetAccountingDeps {
  append: (chunk: UIMessageChunk) => Promise<void>;
  closeSubscribers: () => void;
  ctx: DurableObjectState;
  env: AgentRunEnv;
  markCompleted: (input: StartRunInput) => Promise<void>;
}

/** Emits the rolling budget-status part for a snapshot (no-op when below the floor). */
export async function appendBudgetStatus(
  deps: BudgetAccountingDeps,
  input: StartRunInput,
  snapshot: { tokensIn: number; tokensOut: number; usdSpent: number },
): Promise<void> {
  const chunk = budgetChunk(input, snapshot);
  if (chunk) {
    await deps.append(chunk);
  }
}

/** Emits the budget-status part from the persisted run snapshot. */
export async function appendStoredBudgetStatus(
  deps: BudgetAccountingDeps,
  input: StartRunInput,
): Promise<void> {
  const stored = readStoredRunSnapshot(deps.ctx);
  await appendBudgetStatus(deps, input, stored?.budget ?? ZERO_BUDGET_SNAPSHOT);
}

/** Persists a budget delta and emits the refreshed budget-status part. */
export async function recordBudgetDelta(
  deps: BudgetAccountingDeps,
  input: StartRunInput,
  event: BudgetDelta,
): Promise<StoredBudgetSnapshot> {
  const snapshot = await persistBudgetDelta(deps.ctx, deps.env, input, event);
  await appendBudgetStatus(deps, input, snapshot);
  return snapshot;
}

/** Emits the cost-cap-exhausted parts and finalizes the run as completed. */
export async function appendCostCapExhausted(
  deps: BudgetAccountingDeps,
  input: StartRunInput,
  isAnswerTextOpen: boolean,
  exhaustion: CostCapExhaustion,
): Promise<void> {
  emitUserEvent(deps.env, {
    confidence: 1,
    detector: "cost_spike",
    errorCode: exhaustion.code,
    eventName: "silent_failure_detected",
    runId: input.runId,
    userId: input.userId,
  });
  await deps.append(exhaustion.chunk);
  if (isAnswerTextOpen) {
    await deps.append({ id: "answer", type: "text-end" });
  }
  await appendStoredBudgetStatus(deps, input);
  await deps.append({ finishReason: "stop", type: "finish" });
  await deps.markCompleted(input);
  deps.closeSubscribers();
}

/** Throws a 402 cost-cap error (after finalizing) when the next spend would exceed a cap. */
export async function enforceCostCaps(
  deps: BudgetAccountingDeps,
  input: StartRunInput,
  snapshot: { usdSpent: number },
  isAnswerTextOpen: boolean,
): Promise<void> {
  const exhaustion = costCapExhaustion(input, snapshot.usdSpent);
  if (!exhaustion) {
    return;
  }
  await appendCostCapExhausted(deps, input, isAnswerTextOpen, exhaustion);
  throw new APIError(402, exhaustion.code, exhaustion.message, {
    retriable: false,
  });
}

export function costCapExhaustion(
  input: StartRunInput,
  nextRunCostUsd: number,
): CostCapExhaustion | null {
  if (isBudgetExhausted(input, nextRunCostUsd)) {
    return {
      chunk: budgetCapReachedChunk(),
      code: "budget_cap_reached",
      message: "Run budget cap reached.",
    };
  }
  if (isDailyCostCapExhausted(input, nextRunCostUsd)) {
    return {
      chunk: dailyCostCapReachedChunk(),
      code: "daily_cost_cap_reached",
      message: "Daily cost cap reached.",
    };
  }
  return null;
}

export function isCostCapAPIError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    (error.code === "budget_cap_reached" || error.code === "daily_cost_cap_reached")
  );
}
