export type StreamSeqStorage = Pick<
  Storage,
  "getItem" | "key" | "length" | "removeItem" | "setItem"
>;

const STORAGE_PREFIX = "cc:lastSeq:";
const fallbackSeqByThread = new Map<string, number>();

export function clearStreamSeqState(
  storage: StreamSeqStorage | null = browserSessionStorage(),
): void {
  fallbackSeqByThread.clear();
  if (!storage) {
    return;
  }
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => key?.startsWith(STORAGE_PREFIX) === true,
    );
    for (const key of keys) {
      storage.removeItem(key);
    }
  } catch {
    // The in-memory identity boundary is still cleared when browser storage is unavailable.
  }
}

export function rememberStreamSeq(
  threadId: string,
  seq: number,
  storage: StreamSeqStorage | null = browserSessionStorage(),
): void {
  const normalized = normalizeSeq(seq);
  if (normalized === null) {
    return;
  }

  fallbackSeqByThread.set(threadId, normalized);

  try {
    storage?.setItem(storageKey(threadId), String(normalized));
  } catch {
    // The in-memory fallback above still keeps reconnects working in this tab.
  }
}

function lastStreamSeq(
  threadId: string,
  storage: StreamSeqStorage | null = browserSessionStorage(),
): string {
  const stored = readStoredSeq(threadId, storage);
  if (stored !== null) {
    fallbackSeqByThread.set(threadId, stored);
    return String(stored);
  }

  return String(fallbackSeqByThread.get(threadId) ?? 0);
}

export function streamResumeCursor(
  threadId: string,
  hasReceivedStreamDataInPage: boolean,
  storage: StreamSeqStorage | null = browserSessionStorage(),
): string {
  if (!hasReceivedStreamDataInPage) {
    return "0";
  }

  return lastStreamSeq(threadId, storage);
}

function browserSessionStorage(): StreamSeqStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStoredSeq(threadId: string, storage: StreamSeqStorage | null): number | null {
  if (storage === null) {
    return null;
  }

  try {
    return parseSeq(storage.getItem(storageKey(threadId)));
  } catch {
    return null;
  }
}

function storageKey(threadId: string): string {
  return `${STORAGE_PREFIX}${threadId}`;
}

function normalizeSeq(seq: number): number | null {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    return null;
  }

  return seq;
}

function parseSeq(value: null | string): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }

  return normalizeSeq(Number(value));
}
