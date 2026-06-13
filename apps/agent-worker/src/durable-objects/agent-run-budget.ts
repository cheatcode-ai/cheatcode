import type { UIMessageChunk } from "ai";

interface BudgetedRunInput {
  budgetCapUsd?: number | undefined;
  dailyCostCapUsd?: number | undefined;
  dailyCostUsdAtRunStart?: number | undefined;
}

interface BudgetSnapshot {
  tokensIn: number;
  tokensOut: number;
  usdSpent: number;
}

export const DEFAULT_RUN_BUDGET_CAP_USD = 5;

export function budgetChunk(
  input: BudgetedRunInput,
  snapshot: BudgetSnapshot,
): UIMessageChunk | null {
  return {
    type: "data-budget",
    data: {
      v: 1,
      capUsd: effectiveRunBudgetCapUsd(input),
      tokensIn: snapshot.tokensIn,
      tokensOut: snapshot.tokensOut,
      usdSpent: snapshot.usdSpent,
    },
  };
}

export function isBudgetExhausted(input: BudgetedRunInput, nextCostUsd: number): boolean {
  return nextCostUsd > effectiveRunBudgetCapUsd(input);
}

export function isDailyCostCapExhausted(input: BudgetedRunInput, nextRunCostUsd: number): boolean {
  if (input.dailyCostCapUsd === undefined) {
    return false;
  }
  return (input.dailyCostUsdAtRunStart ?? 0) + nextRunCostUsd > input.dailyCostCapUsd;
}

export function budgetCapReachedChunk(): UIMessageChunk {
  return {
    type: "data-error",
    data: {
      v: 1,
      code: "budget_cap_reached",
      message: "Run budget cap reached.",
      retriable: false,
    },
  };
}

export function dailyCostCapReachedChunk(): UIMessageChunk {
  return {
    type: "data-error",
    data: {
      v: 1,
      code: "daily_cost_cap_reached",
      message: "Daily cost cap reached.",
      retriable: false,
    },
  };
}

export function effectiveRunBudgetCapUsd(input: BudgetedRunInput): number {
  return input.budgetCapUsd ?? DEFAULT_RUN_BUDGET_CAP_USD;
}
