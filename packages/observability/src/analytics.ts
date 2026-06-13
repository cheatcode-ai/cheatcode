import { redactSecrets } from "./redact";

const MAX_BLOB_LENGTH = 1024;

export interface AnalyticsDatasetPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

export interface AnalyticsDataset {
  writeDataPoint(point: AnalyticsDatasetPoint): void;
}

interface AnalyticsDataPoint {
  blobs?: (string | undefined)[];
  doubles?: (number | undefined)[];
  indexes?: (string | undefined)[];
}

export interface AgentMetric {
  agentName: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  envTag?: string;
  errorCode?: string;
  model: string;
  promptTokens?: number;
  runId: string;
  status: "success" | "error";
  stepIdx?: number;
  stepType: string;
  toolCallCount?: number;
  usdCostMicros?: number;
  userId: string;
  versionTag?: string;
  workerName: string;
}

export interface UserEvent {
  authMethod?: string;
  cacheReadTokens?: number;
  cohortMonth?: string;
  cohortWeek?: string;
  country?: string;
  device?: string;
  detector?: string;
  durationMs?: number;
  errorCode?: string;
  eventDate?: string;
  eventName: string;
  confidence?: number;
  fromPlan?: string;
  model?: string;
  mrrCents?: number;
  plan?: string;
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
  tokensIn?: number;
  tokensOut?: number;
  tokensUsed?: number;
  toPlan?: string;
  toolCalls?: number;
  userId: string;
  utmSource?: string;
  valueUsdMicros?: number;
}

export interface ErrorEvent {
  durationMs?: number;
  errorCategory: string;
  errorCode: string;
  httpStatus?: number;
  message?: string;
  retryCount?: number;
  route?: string;
  runId?: string;
  stack?: string;
  userId?: string;
  versionTag?: string;
  workerName: string;
}

export interface PerformanceMetric {
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

export interface CostEvent {
  cacheHit?: boolean;
  day: string;
  model: string;
  runId: string;
  tokensIn?: number;
  tokensOut?: number;
  toolName?: string;
  usdMicros?: number;
  userId: string;
}

export interface AnalyticsBindings {
  AGENT_METRICS?: AnalyticsDataset;
  COST_EVENTS?: AnalyticsDataset;
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
      metric.model,
      metric.stepType,
      metric.status,
      metric.errorCode,
      metric.workerName,
      metric.envTag,
      metric.versionTag,
    ],
    doubles: [
      metric.durationMs,
      metric.promptTokens,
      metric.completionTokens,
      metric.cacheReadTokens,
      metric.cacheWriteTokens,
      metric.usdCostMicros,
      metric.stepIdx,
      metric.toolCallCount,
    ],
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
      event.runId,
      event.authMethod,
      event.templateId,
      event.model,
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
      event.valueUsdMicros,
      event.promptLength,
      event.durationMs,
      event.tokensUsed,
      event.toolCalls,
      event.confidence,
      event.tokensIn,
      event.tokensOut,
      event.cacheReadTokens,
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
      truncate(event.message),
      stackTop(event.stack),
    ],
    doubles: [event.httpStatus, event.retryCount, event.durationMs],
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

export function emitCostEvent(env: AnalyticsBindings, event: CostEvent): void {
  writePoint(env.COST_EVENTS, {
    indexes: [event.userId],
    blobs: [
      event.model,
      event.toolName,
      event.cacheHit === undefined ? undefined : String(event.cacheHit),
      event.runId,
      event.day,
    ],
    doubles: [event.usdMicros, event.tokensIn, event.tokensOut],
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

function stackTop(stack: string | undefined): string {
  return truncate(stack?.split("\n").slice(0, 3).join("\n"));
}
