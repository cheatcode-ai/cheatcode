type PerformancePhase =
  | "authSecret"
  | "authVerification"
  | "databaseConnection"
  | "databaseContext"
  | "databaseQuery"
  | "durableObject"
  | "finalToken"
  | "firstModelText"
  | "firstStatus"
  | "rateLimit"
  | "responseHeaders"
  | "runCompletion"
  | "serviceBinding"
  | "userLookup"
  | "workflowAcceptance";

interface PerformanceTimingFields {
  authSecretMs?: number;
  authVerificationMs?: number;
  dbConnectionMs?: number;
  dbContextMs?: number;
  dbQueryMs?: number;
  durableObjectMs?: number;
  finalTokenMs?: number;
  firstModelTextMs?: number;
  firstStatusMs?: number;
  rateLimitMs?: number;
  responseHeadersMs?: number;
  runCompletionMs?: number;
  serviceBindingMs?: number;
  userLookupMs?: number;
  workflowAcceptanceMs?: number;
}

export interface PerformanceRecorder {
  add(phase: PerformancePhase, durationMs: number): void;
  elapsedMs(): number;
  measure<T>(phase: PerformancePhase, operation: () => Promise<T>): Promise<T>;
  snapshot(): PerformanceTimingFields;
}

const PHASE_FIELDS = {
  authSecret: "authSecretMs",
  authVerification: "authVerificationMs",
  databaseConnection: "dbConnectionMs",
  databaseContext: "dbContextMs",
  databaseQuery: "dbQueryMs",
  durableObject: "durableObjectMs",
  finalToken: "finalTokenMs",
  firstModelText: "firstModelTextMs",
  firstStatus: "firstStatusMs",
  rateLimit: "rateLimitMs",
  responseHeaders: "responseHeadersMs",
  runCompletion: "runCompletionMs",
  serviceBinding: "serviceBindingMs",
  userLookup: "userLookupMs",
  workflowAcceptance: "workflowAcceptanceMs",
} as const satisfies Record<PerformancePhase, keyof PerformanceTimingFields>;

export function createPerformanceRecorder(now = () => performance.now()): PerformanceRecorder {
  const startedAt = now();
  const durations = new Map<PerformancePhase, number>();
  return {
    add(phase, durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) return;
      durations.set(phase, (durations.get(phase) ?? 0) + durationMs);
    },
    elapsedMs: () => Math.max(0, now() - startedAt),
    async measure(phase, operation) {
      const phaseStartedAt = now();
      try {
        return await operation();
      } finally {
        this.add(phase, Math.max(0, now() - phaseStartedAt));
      }
    },
    snapshot() {
      const fields: PerformanceTimingFields = {};
      for (const [phase, durationMs] of durations) {
        fields[PHASE_FIELDS[phase]] = durationMs;
      }
      return fields;
    },
  };
}

export function safeServerTiming(recorder: PerformanceRecorder): string {
  const timing = recorder.snapshot();
  return [
    serverTimingEntry(
      "auth",
      sum(timing.authSecretMs, timing.authVerificationMs, timing.userLookupMs),
    ),
    serverTimingEntry("rate", timing.rateLimitMs),
    serverTimingEntry("db", sum(timing.dbConnectionMs, timing.dbContextMs, timing.dbQueryMs)),
    serverTimingEntry(
      "upstream",
      sum(timing.serviceBindingMs, timing.durableObjectMs, timing.workflowAcceptanceMs),
    ),
    serverTimingEntry("edge", recorder.elapsedMs()),
  ]
    .filter((entry): entry is string => entry !== undefined)
    .join(", ");
}

function sum(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length === 0 ? undefined : present.reduce((total, value) => total + value, 0);
}

function serverTimingEntry(name: string, durationMs: number | undefined): string | undefined {
  return durationMs === undefined ? undefined : `${name};dur=${durationMs.toFixed(1)}`;
}
