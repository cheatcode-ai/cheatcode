const CODE_SERVER_DEADLINE_KEY = "project_sandbox_code_server_alarm_at";
const KEEPALIVE_DEADLINE_KEY = "project_sandbox_keepalive_alarm_at";
const ALARM_DUE_TOLERANCE_MS = 1_000;

export interface ProjectSandboxAlarmTasks {
  codeServer: boolean;
  keepalive: boolean;
}

export function scheduleCodeServerAlarm(
  storage: DurableObjectStorage,
  scheduledAtMs: number | null,
): Promise<void> {
  return updateAlarmDeadline(storage, CODE_SERVER_DEADLINE_KEY, scheduledAtMs);
}

export function scheduleKeepaliveAlarm(
  storage: DurableObjectStorage,
  scheduledAtMs: number | null,
): Promise<void> {
  return updateAlarmDeadline(storage, KEEPALIVE_DEADLINE_KEY, scheduledAtMs);
}

export async function projectSandboxAlarmTasksDue(
  storage: DurableObjectStorage,
): Promise<ProjectSandboxAlarmTasks> {
  const [codeServerAt, keepaliveAt] = await Promise.all([
    storage.get<number>(CODE_SERVER_DEADLINE_KEY),
    storage.get<number>(KEEPALIVE_DEADLINE_KEY),
  ]);
  const dueAt = Date.now() + ALARM_DUE_TOLERANCE_MS;
  // A pre-multiplexer deployment may already have a keepalive alarm but no
  // deadline keys. Treat that one alarm as keepalive work and migrate in place.
  const isLegacyAlarm = codeServerAt === undefined && keepaliveAt === undefined;
  return {
    codeServer: codeServerAt !== undefined && codeServerAt <= dueAt,
    keepalive: isLegacyAlarm || (keepaliveAt !== undefined && keepaliveAt <= dueAt),
  };
}

export function rescheduleProjectSandboxAlarm(storage: DurableObjectStorage): Promise<void> {
  return storage.transaction((transaction) => applyEarliestAlarm(transaction));
}

function updateAlarmDeadline(
  storage: DurableObjectStorage,
  key: string,
  scheduledAtMs: number | null,
): Promise<void> {
  return storage.transaction(async (transaction) => {
    await adoptLegacyKeepaliveAlarm(transaction);
    if (scheduledAtMs === null) {
      await transaction.delete(key);
    } else {
      await transaction.put(key, scheduledAtMs);
    }
    await applyEarliestAlarm(transaction);
  });
}

async function adoptLegacyKeepaliveAlarm(transaction: DurableObjectTransaction): Promise<void> {
  const [codeServerAt, keepaliveAt] = await Promise.all([
    transaction.get<number>(CODE_SERVER_DEADLINE_KEY),
    transaction.get<number>(KEEPALIVE_DEADLINE_KEY),
  ]);
  if (codeServerAt !== undefined || keepaliveAt !== undefined) return;
  const legacyAlarmAt = await transaction.getAlarm();
  if (legacyAlarmAt !== null) {
    await transaction.put(KEEPALIVE_DEADLINE_KEY, legacyAlarmAt);
  }
}

async function applyEarliestAlarm(transaction: DurableObjectTransaction): Promise<void> {
  const [codeServerAt, keepaliveAt] = await Promise.all([
    transaction.get<number>(CODE_SERVER_DEADLINE_KEY),
    transaction.get<number>(KEEPALIVE_DEADLINE_KEY),
  ]);
  const deadlines = [codeServerAt, keepaliveAt].filter(
    (value): value is number => value !== undefined,
  );
  if (deadlines.length === 0) {
    await transaction.deleteAlarm();
    return;
  }
  await transaction.setAlarm(Math.min(...deadlines));
}
