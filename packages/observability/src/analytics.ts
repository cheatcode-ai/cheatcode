import type { LogicalModelId } from "@cheatcode/types";
import { redactSecrets } from "./redact";

const MAX_BLOB_LENGTH = 1024;

interface AnalyticsDatasetPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

interface AnalyticsDataset {
  writeDataPoint(point: AnalyticsDatasetPoint): void;
}

interface AnalyticsDataPoint {
  blobs?: (string | undefined)[];
  doubles?: (number | undefined)[];
  indexes?: (string | undefined)[];
}

interface AgentMetricFields {
  agentName: string;
  durationMs?: number;
  envTag?: string;
  errorCode?: string;
  runId: string;
  status: "success" | "error";
  stepIdx?: number;
  stepType: string;
  toolCallCount?: number;
  userId: string;
  versionTag?: string;
  workerName: string;
}

type ModelAttribution =
  | { logicalModelId: LogicalModelId; plannedModelId?: never }
  | { logicalModelId?: never; plannedModelId: LogicalModelId | "unknown" };

export type AgentMetric = AgentMetricFields & ModelAttribution;

interface UserEvent {
  authMethod?: string;
  cohortMonth?: string;
  cohortWeek?: string;
  country?: string;
  device?: string;
  detector?: string;
  durationMs?: number;
  errorCode?: string;
  eventDate?: string;
  eventId?: string;
  eventName: string;
  confidence?: number;
  fromPlan?: string;
  logicalModelId?: LogicalModelId;
  mrrCents?: number;
  plan?: string;
  plannedModelId?: LogicalModelId | "unknown";
  promptLength?: number;
  referrer?: string;
  resultBytes?: number;
  runId?: string;
  runStatus?: string;
  skillName?: string;
  stepIdx?: number;
  stepType?: string;
  templateId?: string;
  toolName?: string;
  toPlan?: string;
  toolCalls?: number;
  userId: string;
  utmSource?: string;
}

export interface ErrorEvent {
  causeCode?: string;
  causeConstraint?: string;
  causeName?: string;
  causeRetriable?: boolean;
  causeStatus?: number;
  constraint?: string;
  durationMs?: number;
  errorCategory: string;
  errorCode: string;
  errorName?: string;
  httpStatus?: number;
  retriable?: boolean;
  retryCount?: number;
  route?: string;
  runId?: string;
  sourceErrorCode?: string;
  status?: number;
  userId?: string;
  versionTag?: string;
  workerName: string;
}

interface PerformanceMetric {
  dbQueryMs?: number;
  envTag?: string;
  llmMs?: number;
  metricName?: string;
  queueWaitMs?: number;
  route: string;
  sandboxMs?: number;
  statusClass: string;
  totalMs?: number;
  ttftMs?: number;
  versionTag?: string;
  workerName: string;
}

export interface AnalyticsBindings {
  AGENT_METRICS?: AnalyticsDataset;
  ERROR_EVENTS?: AnalyticsDataset;
  PERFORMANCE_METRICS?: AnalyticsDataset;
  USER_EVENTS?: AnalyticsDataset;
}

export function emitAgentMetric(env: AnalyticsBindings, metric: AgentMetric): void {
  writePoint(env.AGENT_METRICS, {
    indexes: [metric.userId],
    blobs: [
      metric.runId,
      metric.agentName,
      metric.logicalModelId ?? metric.plannedModelId,
      metric.stepType,
      metric.status,
      metric.errorCode,
      metric.workerName,
      metric.envTag,
      metric.versionTag,
    ],
    doubles: [metric.durationMs, metric.stepIdx, metric.toolCallCount],
  });
}

export function emitUserEvent(env: AnalyticsBindings, event: UserEvent): void {
  writePoint(env.USER_EVENTS, {
    indexes: [event.userId],
    blobs: [
      event.eventName,
      event.plan,
      event.referrer,
      event.utmSource,
      event.country,
      event.eventId ?? event.runId,
      event.authMethod,
      event.templateId,
      event.logicalModelId ?? event.plannedModelId,
      event.errorCode,
      event.detector,
      event.runStatus,
      event.eventDate,
      event.fromPlan,
      event.toPlan,
      event.cohortWeek,
      event.cohortMonth,
      event.stepType,
      event.toolName,
      event.skillName,
    ],
    doubles: [
      event.mrrCents,
      event.promptLength,
      event.durationMs,
      event.toolCalls,
      event.confidence,
      event.stepIdx,
      event.resultBytes,
    ],
  });
}

export function emitErrorEvent(env: AnalyticsBindings, event: ErrorEvent): void {
  writePoint(env.ERROR_EVENTS, {
    indexes: [event.workerName],
    blobs: [
      event.errorCategory,
      event.errorCode,
      event.route,
      event.userId,
      event.runId,
      event.versionTag,
      event.errorName,
      event.sourceErrorCode,
      event.constraint,
      event.causeName,
      event.causeCode,
      event.causeConstraint,
      booleanLabel(event.retriable),
      booleanLabel(event.causeRetriable),
    ],
    doubles: [
      event.httpStatus,
      event.retryCount,
      event.durationMs,
      event.status,
      event.causeStatus,
    ],
  });
}

export function emitPerformanceMetric(env: AnalyticsBindings, metric: PerformanceMetric): void {
  writePoint(env.PERFORMANCE_METRICS, {
    indexes: [metric.route],
    blobs: [
      metric.workerName,
      metric.envTag,
      metric.versionTag,
      metric.statusClass,
      metric.metricName,
    ],
    doubles: [
      metric.ttftMs,
      metric.totalMs,
      metric.dbQueryMs,
      metric.sandboxMs,
      metric.llmMs,
      metric.queueWaitMs,
    ],
  });
}

function writePoint(dataset: AnalyticsDataset | undefined, point: AnalyticsDataPoint): void {
  dataset?.writeDataPoint({
    indexes: sanitizeBlobs(point.indexes).slice(0, 1),
    blobs: sanitizeBlobs(point.blobs).slice(0, 20),
    doubles: sanitizeDoubles(point.doubles).slice(0, 20),
  });
}

function sanitizeBlobs(values: (string | undefined)[] | undefined): string[] {
  return (values ?? []).map((value) => truncate(value ?? ""));
}

function sanitizeDoubles(values: (number | undefined)[] | undefined): number[] {
  return (values ?? []).map((value) => (Number.isFinite(value) ? Number(value) : 0));
}

function truncate(value: string | undefined): string {
  const normalized = redactSecrets(value ?? "");
  return normalized.length > MAX_BLOB_LENGTH ? normalized.slice(0, MAX_BLOB_LENGTH) : normalized;
}

function booleanLabel(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}
