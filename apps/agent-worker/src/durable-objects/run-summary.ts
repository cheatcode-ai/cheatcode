import { isMessagePartRow } from "../streaming/ui-message-stream";

export type AgentRunSnapshotStatus = "idle" | "running" | "completed" | "failed" | "canceled";

const SUMMARY_MAX_LENGTH = 240;
const SNAPSHOT_STATUSES = new Set(["running", "completed", "failed", "canceled"]);

export function snapshotAgentRunStatus(status: string | undefined): AgentRunSnapshotStatus {
  return SNAPSHOT_STATUSES.has(status ?? "") ? (status as AgentRunSnapshotStatus) : "idle";
}

export function summarizeAgentRunRows(rows: unknown[], status: AgentRunSnapshotStatus): string {
  if (status === "failed" || status === "canceled") {
    const errorSummary = errorMessageFromRows(rows);
    if (errorSummary) {
      return compactSummary(errorSummary);
    }
  }
  return compactSummary(rows.map(textDeltaFromRow).join(""));
}

function errorMessageFromRows(rows: unknown[]): string {
  let message = "";
  for (const row of rows) {
    const chunk = parsedChunkFromRow(row);
    if (!chunk || chunk["type"] !== "data-error") {
      continue;
    }
    const data = chunk["data"];
    if (!isRecord(data) || typeof data["message"] !== "string") {
      continue;
    }
    const candidate = data["message"].trim();
    if (candidate) {
      message = candidate;
    }
  }
  return message;
}

function textDeltaFromRow(row: unknown): string {
  const chunk = parsedChunkFromRow(row);
  if (!chunk) {
    return "";
  }
  return chunk["type"] === "text-delta" && typeof chunk["delta"] === "string" ? chunk["delta"] : "";
}

function parsedChunkFromRow(row: unknown): Record<string, unknown> | null {
  if (!isMessagePartRow(row)) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function compactSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
