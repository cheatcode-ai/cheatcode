import { isMessagePartRow } from "../streaming/ui-message-stream";

export type AgentRunSnapshotStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

const SUMMARY_MAX_LENGTH = 240;
const SUMMARY_QUERY_PAGE_SIZE = 100;
const SNAPSHOT_STATUSES = new Set(["running", "paused", "completed", "failed", "canceled"]);

export function snapshotAgentRunStatus(status: string | undefined): AgentRunSnapshotStatus {
  return SNAPSHOT_STATUSES.has(status ?? "") ? (status as AgentRunSnapshotStatus) : "idle";
}

export function summarizeAgentRunStorage(
  ctx: DurableObjectState,
  status: AgentRunSnapshotStatus,
): string {
  if (status === "failed" || status === "canceled") {
    const errorSummary = latestErrorMessage(ctx);
    if (errorSummary) {
      return compactSummary(errorSummary);
    }
  }
  return firstTextSummary(ctx);
}

function latestErrorMessage(ctx: DurableObjectState): string {
  const rows = ctx.storage.sql
    .exec(
      `SELECT seq, payload_json FROM message_part
       WHERE part_type = 'data-error'
       ORDER BY seq DESC LIMIT 1`,
    )
    .toArray();
  const chunk = parsedChunkFromRow(rows[0]);
  const data = chunk?.["data"];
  return isRecord(data) && typeof data["message"] === "string" ? data["message"].trim() : "";
}

function firstTextSummary(ctx: DurableObjectState): string {
  let cursor = 0;
  let summary = "";
  while (summary.length < SUMMARY_MAX_LENGTH) {
    const rows = ctx.storage.sql
      .exec(
        `SELECT seq, payload_json FROM message_part
         WHERE seq > ? AND part_type = 'text-delta'
         ORDER BY seq LIMIT ?`,
        cursor,
        SUMMARY_QUERY_PAGE_SIZE,
      )
      .toArray();
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      const chunk = parsedChunkFromRow(row);
      const seq = isRecord(row) && typeof row["seq"] === "number" ? row["seq"] : cursor;
      cursor = Math.max(cursor, seq);
      if (chunk?.["type"] === "text-delta" && typeof chunk["delta"] === "string") {
        summary = compactSummary(`${summary} ${chunk["delta"]}`);
      }
    }
  }
  return summary;
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
