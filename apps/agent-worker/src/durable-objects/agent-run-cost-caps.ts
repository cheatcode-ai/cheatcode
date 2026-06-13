import { APIError } from "@cheatcode/observability";
import type { UIMessageChunk } from "ai";
import {
  budgetCapReachedChunk,
  dailyCostCapReachedChunk,
  isBudgetExhausted,
  isDailyCostCapExhausted,
} from "./agent-run-budget";
import type { StartRunInput } from "./agent-run-schemas";

export type CostCapExhaustion = {
  chunk: UIMessageChunk;
  code: "budget_cap_reached" | "daily_cost_cap_reached";
  message: string;
};

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
