import { APIError } from "@cheatcode/observability";
import { type DaytonaSandbox, WorkspacePathSchema } from "@cheatcode/tools-code";
import { z } from "zod";
import type { ProjectStartProcessInputSchema } from "./project-sandbox-runtime";

export const APP_PREVIEW_SLOT_PREFIX = "app-preview:";
export const ENV_FILE_DIR = "/home/node/.cc-env";
const MOBILE_PORT_BASE = 8081;
export const PORT_ALLOC_KEY = "port_alloc";
export const PROCESS_PORT_ALLOC_KEY = "process_port_alloc";
const PROCESS_PORT_RESERVATION_TTL_MS = 6 * 60 * 60 * 1_000;
export const PROC_PREFIX = "proc:";
export const MAX_TRACKED_PROCESSES = 32;
const WEB_PORT_BASE = 5173;

export const ProcessRecordSchema = z
  .object({
    sessionId: z
      .string()
      .min(1)
      .max(250)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    cmdId: z.string(),
    command: z.string(),
    port: z.number().optional(),
    isMobile: z.boolean().optional(),
    keepAliveTimeoutMs: z.number().int().nonnegative().optional(),
    maxRestarts: z.number().int().nonnegative().optional(),
    restartOnFailure: z.boolean().optional(),
    cwd: WorkspacePathSchema,
    startedAtMs: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ProcessRecord = z.infer<typeof ProcessRecordSchema>;
export type NamedProcessRecord = { name: string; record: ProcessRecord };
export type ParsedProcessStartInput = z.infer<typeof ProjectStartProcessInputSchema>;
export type ProcessPolicy = Pick<
  ProcessRecord,
  "keepAliveTimeoutMs" | "maxRestarts" | "restartOnFailure"
>;

export class ProcessMutationQueue {
  private tail: Promise<void> = Promise.resolve();

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.tail = queued;
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.tail === queued) {
        this.tail = Promise.resolve();
      }
    }
  }
}

export const PortAllocationSchema = z
  .object({
    webNext: z.number().int().positive().default(WEB_PORT_BASE),
    mobileNext: z.number().int().positive().default(MOBILE_PORT_BASE),
    ports: z.record(z.string(), z.number().int().positive()).default({}),
  })
  .strict();

export const ProcessPortReservationsSchema = z
  .record(
    z.string(),
    z
      .object({
        port: z.number().int().positive().max(65_535),
        reservedAtMs: z.number().int().nonnegative(),
      })
      .strict(),
  )
  .default({});
export type ProcessPortReservations = z.infer<typeof ProcessPortReservationsSchema>;

export function timeoutSeconds(timeoutMs: number | undefined): number {
  return timeoutMs ? Math.max(1, Math.ceil(timeoutMs / 1_000)) : 600;
}

export function assertValidProcessStart(input: ParsedProcessStartInput): void {
  if ((input.maxRestarts ?? 0) > 0 && input.restartOnFailure !== true) {
    throw new APIError(400, "invalid_request_body", "maxRestarts requires restartOnFailure.", {
      retriable: false,
    });
  }
}

export function processRecordFromLaunch(
  input: ParsedProcessStartInput,
  policy: ProcessPolicy,
  launch: Pick<ProcessRecord, "cmdId" | "command" | "cwd" | "sessionId">,
): ProcessRecord {
  return {
    ...launch,
    ...(input.isMobile === undefined ? {} : { isMobile: input.isMobile }),
    ...policy,
    ...(input.waitForPort ? { port: input.waitForPort.port } : {}),
    startedAtMs: Date.now(),
  };
}

export function supervisedProcessCommand(command: string, policy: ProcessPolicy): string {
  const maxRestarts = policy.restartOnFailure ? (policy.maxRestarts ?? 0) : 0;
  const keepAliveTimeoutMs = policy.keepAliveTimeoutMs ?? 0;
  if (maxRestarts === 0 && keepAliveTimeoutMs <= 0) {
    return `exec ${command}`;
  }
  const restarted = maxRestarts > 0 ? restartLoop(command, maxRestarts) : command;
  if (keepAliveTimeoutMs <= 0) {
    return restarted;
  }
  const keepAliveSeconds = Math.max(1, Math.ceil(keepAliveTimeoutMs / 1_000));
  return `exec timeout --signal=TERM --kill-after=5s ${keepAliveSeconds}s bash -lc ${shellQuote(restarted)}`;
}

function restartLoop(command: string, maxRestarts: number): string {
  return `attempt=0
while :; do
  ${command}
  status=$?
  if [ "$status" -eq 0 ] || [ "$attempt" -ge ${maxRestarts} ]; then exit "$status"; fi
  attempt=$((attempt + 1))
  sleep 1
done`;
}

export function pruneExpiredProcessPortReservations(
  reservations: ProcessPortReservations,
  processRecords: Map<string, unknown>,
  now: number,
): ProcessPortReservations {
  const activeProcessIds = new Set(
    [...processRecords.entries()]
      .filter(([, value]) => ProcessRecordSchema.safeParse(value).success)
      .map(([key]) => key.slice(PROC_PREFIX.length)),
  );
  return Object.fromEntries(
    Object.entries(reservations).filter(
      ([processId, reservation]) =>
        activeProcessIds.has(processId) ||
        now - reservation.reservedAtMs <= PROCESS_PORT_RESERVATION_TTL_MS,
    ),
  );
}

export function usedProcessPorts(
  reservations: ProcessPortReservations,
  processRecords: Map<string, unknown>,
  excludedProcessId: string,
): Set<number> {
  const used = new Set(
    Object.entries(reservations)
      .filter(([processId]) => processId !== excludedProcessId)
      .map(([, reservation]) => reservation.port),
  );
  for (const [key, value] of processRecords) {
    const record = ProcessRecordSchema.safeParse(value);
    if (
      key.slice(PROC_PREFIX.length) !== excludedProcessId &&
      record.success &&
      record.data.port !== undefined
    ) {
      used.add(record.data.port);
    }
  }
  return used;
}

export function firstAvailablePort(
  used: Set<number>,
  minPort: number,
  maxPort: number,
): number | null {
  for (let port = minPort; port <= maxPort; port += 1) {
    if (!used.has(port)) {
      return port;
    }
  }
  return null;
}

export function withoutProcessReservation(
  reservations: ProcessPortReservations,
  processId: string,
): ProcessPortReservations {
  return Object.fromEntries(
    Object.entries(reservations).filter(([candidate]) => candidate !== processId),
  );
}

export function restartEnvironment(
  name: string,
  record: ProcessRecord,
): Record<string, string> | undefined {
  if (!name.startsWith(APP_PREVIEW_SLOT_PREFIX) || record.port === undefined) {
    return undefined;
  }
  if (record.isMobile) {
    return { CI: "1", EXPO_NO_TELEMETRY: "1", PORT: String(record.port) };
  }
  return {
    CHOKIDAR_USEPOLLING: "true",
    PORT: String(record.port),
    WATCHPACK_POLLING: "1000",
  };
}

export function isDestroyed(sandbox: DaytonaSandbox): boolean {
  return sandbox.state === "destroyed" || sandbox.state === "destroying";
}

export function isFailedState(state: string): boolean {
  return state === "error" || state === "build_failed";
}

export function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
