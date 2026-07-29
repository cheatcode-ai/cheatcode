import type { WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  type Database,
  type HyperdriveConnection,
  type UserContextDatabase,
  withDatabase as withDatabaseHandle,
  withUserDb,
} from "@cheatcode/db";
import type { WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  createLogger,
  emitErrorEvent,
  safeErrorTelemetry,
} from "@cheatcode/observability";
import type { UserId } from "@cheatcode/types";
import { z } from "zod";

const DELETION_ACTIONS_PER_INSTANCE = 8;
const DB_STEP_OPTIONS = {
  retries: { limit: 3, delay: "20 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;
export const CREATE_STEP_OPTIONS = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;

export type DeletionActionOutcome = "advanced" | "completed" | "noop";
export type DeletionWorkflowOutcome =
  | "completed"
  | "continued"
  | "deferred"
  | "noop"
  | "quarantined";

interface WebhooksDatabaseEnv {
  DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
  HYPERDRIVE: HyperdriveConnection;
}

interface DeferredDeletion {
  failureCount: number;
  status?: string;
}

interface QuarantinePolicy<Env, Lease> {
  errorEventName: string;
  errorRoute: string;
  failureName: string;
  fallbackMessage: string;
  identity: (lease: Lease) => Record<string, string | number>;
  logEventName: string;
  message: (errorCode: string) => string;
  quarantine: (
    env: Env,
    step: WorkflowStep,
    lease: Lease,
    errorCode: string,
    label: string,
  ) => Promise<boolean>;
  terminationStepName: (label: string) => string;
}

interface DeletionJobRunnerConfig<
  Env extends AnalyticsBindings,
  Lease,
  Deferred extends DeferredDeletion,
> {
  classify: (error: unknown) => { errorCode: string; permanent: boolean };
  defer: (
    env: Env,
    step: WorkflowStep,
    lease: Lease,
    errorCode: string,
    label: string,
  ) => Promise<Deferred | null>;
  onDeferred: (
    env: Env,
    lease: Lease,
    error: unknown,
    errorCode: string,
    label: string,
    deferred: Deferred | null,
  ) => void;
  quarantine?: QuarantinePolicy<Env, Lease>;
}

export interface DeletionJobRunner<Env extends AnalyticsBindings, Lease> {
  errorCode(error: unknown): string;
  handleFailure(
    env: Env,
    step: WorkflowStep,
    lease: Lease,
    error: unknown,
    label: string,
  ): Promise<{ outcome: DeletionWorkflowOutcome }>;
  reportQuarantine(
    env: Env,
    identity: Record<string, string | number>,
    error: unknown,
    errorCode: string,
  ): void;
}

export function createDeletionJobRunner<
  Env extends AnalyticsBindings,
  Lease,
  Deferred extends DeferredDeletion,
>(config: DeletionJobRunnerConfig<Env, Lease, Deferred>): DeletionJobRunner<Env, Lease> {
  const reportQuarantine = (
    env: Env,
    identity: Record<string, string | number>,
    error: unknown,
    errorCode: string,
  ): void => {
    const quarantine = requiredQuarantine(config);
    createLogger().error(quarantine.logEventName, {
      errorCode,
      ...identity,
      ...safeErrorTelemetry(error),
    });
    emitErrorEvent(env, {
      errorCategory: "lifecycle",
      errorCode: quarantine.errorEventName,
      route: quarantine.errorRoute,
      workerName: "webhooks",
    });
  };
  return {
    errorCode: (error) => config.classify(error).errorCode,
    handleFailure: (env, step, lease, error, label) =>
      handleDeletionFailure(
        config,
        (reportEnv, reportLease, reportError, errorCode) =>
          reportQuarantine(
            reportEnv,
            requiredQuarantine(config).identity(reportLease),
            reportError,
            errorCode,
          ),
        env,
        step,
        lease,
        error,
        label,
      ),
    reportQuarantine,
  };
}

async function handleDeletionFailure<
  Env extends AnalyticsBindings,
  Lease,
  Deferred extends DeferredDeletion,
>(
  config: DeletionJobRunnerConfig<Env, Lease, Deferred>,
  reportQuarantine: (env: Env, lease: Lease, error: unknown, errorCode: string) => void,
  env: Env,
  step: WorkflowStep,
  lease: Lease,
  error: unknown,
  label: string,
): Promise<{ outcome: DeletionWorkflowOutcome }> {
  const classification = config.classify(error);
  if (classification.permanent && config.quarantine) {
    const quarantined = await config.quarantine.quarantine(
      env,
      step,
      lease,
      classification.errorCode,
      label,
    );
    if (!quarantined) {
      return { outcome: "noop" };
    }
    reportQuarantine(env, lease, error, classification.errorCode);
    return terminateQuarantined(step, config.quarantine, classification.errorCode, label);
  }
  const deferred = await config.defer(env, step, lease, classification.errorCode, label);
  config.onDeferred(env, lease, error, classification.errorCode, label, deferred);
  if (!deferred) {
    return { outcome: "noop" };
  }
  if (deferred.status === "quarantined" && config.quarantine) {
    reportQuarantine(env, lease, error, classification.errorCode);
    return terminateQuarantined(step, config.quarantine, classification.errorCode, label);
  }
  return { outcome: "deferred" };
}

async function terminateQuarantined<Env, Lease>(
  step: WorkflowStep,
  policy: QuarantinePolicy<Env, Lease>,
  errorCode: string,
  label: string,
): Promise<never> {
  await step.do(
    policy.terminationStepName(label),
    { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
    async () => {
      throw new NonRetryableError(policy.message(errorCode), policy.failureName);
    },
  );
  throw new NonRetryableError(policy.fallbackMessage);
}

function requiredQuarantine<Env, Lease, Deferred extends DeferredDeletion>(
  config: DeletionJobRunnerConfig<Env & AnalyticsBindings, Lease, Deferred>,
): QuarantinePolicy<Env & AnalyticsBindings, Lease> {
  if (!config.quarantine) {
    throw new Error("Deletion runner has no quarantine policy");
  }
  return config.quarantine;
}

export function deletionErrorClassifier(options: {
  invalidStateCode: string;
  invariantCode: string;
  isInvariant: (error: unknown) => boolean;
}): (error: unknown) => { errorCode: string; permanent: boolean } {
  return (error) => ({
    errorCode: deletionErrorCode(error, options),
    permanent: isPermanentDeletionError(error, options.isInvariant),
  });
}

function isPermanentDeletionError(
  error: unknown,
  isInvariant: (error: unknown) => boolean,
): boolean {
  if (error instanceof APIError) {
    return !error.retriable;
  }
  if (error instanceof z.ZodError || isInvariant(error)) {
    return true;
  }
  return readRetriable(error) === false;
}

function deletionErrorCode(
  error: unknown,
  options: {
    invalidStateCode: string;
    invariantCode: string;
    isInvariant: (error: unknown) => boolean;
  },
): string {
  if (error instanceof APIError) {
    return error.code;
  }
  if (error instanceof z.ZodError) {
    return options.invalidStateCode;
  }
  if (options.isInvariant(error)) {
    return options.invariantCode;
  }
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.:$-]{0,127}$/u.test(name) ? name : "UnknownError";
}

function readRetriable(error: unknown): boolean | undefined {
  if (typeof error !== "object" || error === null || !("retriable" in error)) {
    return undefined;
  }
  return typeof error.retriable === "boolean" ? error.retriable : undefined;
}

export async function runDeletionActions<Job>(input: {
  continueDeletion: () => Promise<{ outcome: DeletionWorkflowOutcome }>;
  load: (action: number) => Promise<Job | null>;
  process: (job: Job, action: number) => Promise<DeletionActionOutcome>;
}): Promise<{ outcome: DeletionWorkflowOutcome }> {
  for (let action = 1; action <= DELETION_ACTIONS_PER_INSTANCE; action += 1) {
    const job = await input.load(action);
    if (!job) {
      return { outcome: "noop" };
    }
    const outcome = await input.process(job, action);
    if (outcome !== "advanced") {
      return { outcome };
    }
  }
  return input.continueDeletion();
}

export async function continuationLeaseToken(
  seed: string,
  incompleteError: () => Error,
): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  ).slice(0, 16);
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw incompleteError();
  }
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function dbStep<Result extends Rpc.Serializable<Result>>(
  step: WorkflowStep,
  name: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  return step.do(name, DB_STEP_OPTIONS, operation);
}

export async function withDatabase<Result>(
  env: WebhooksDatabaseEnv,
  operation: (db: Database) => Promise<Result>,
): Promise<Result> {
  return withDatabaseHandle(env, ({ db }) => operation(db));
}

export function withUserDatabase<Result>(
  env: WebhooksDatabaseEnv,
  userId: UserId,
  operation: (db: UserContextDatabase) => Promise<Result>,
): Promise<Result> {
  return withUserDb(env, userId, ({ transaction }) => transaction(operation));
}
