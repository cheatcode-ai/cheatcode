import { createRequire } from "node:module";
import { join } from "node:path";
import type { PgClient } from "../packages/db/src/supabase-target";
import { timeoutBeforeDeadline } from "./operation-deadline";

interface QueryResult {
  rows: Record<string, unknown>[];
}

interface NativePgClient {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  query(config: { query_timeout: number; text: string; values?: unknown[] }): Promise<QueryResult>;
}

interface PgModule {
  Client: new (config: {
    allowExitOnIdle: boolean;
    connectionString: string;
    connectionTimeoutMillis: number;
    query_timeout: number;
  }) => NativePgClient;
}

/** Creates a pg client whose connection and every query are clipped to one absolute deadline. */
export function createDeadlineAwarePgClient(
  root: string,
  databaseUrl: string,
  deadline: number,
  maximumQueryMs: number,
  label = "Database operation",
): PgClient {
  const dbRequire = createRequire(join(root, "packages/db/package.json"));
  const { Client } = dbRequire("pg") as PgModule;
  const client = new Client({
    allowExitOnIdle: true,
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutBeforeDeadline(15_000, deadline, label),
    query_timeout: timeoutBeforeDeadline(maximumQueryMs, deadline, label),
  });
  return {
    connect: () =>
      awaitBeforeDeadline(() => client.connect(), 15_000, deadline, `${label} connect`),
    end: () => client.end(),
    query: async (text, values) => {
      const result = await client.query({
        query_timeout: timeoutBeforeDeadline(maximumQueryMs, deadline, label),
        text,
        ...(values === undefined ? {} : { values }),
      });
      timeoutBeforeDeadline(1, deadline, label);
      return result;
    },
  };
}

async function awaitBeforeDeadline<T>(
  operation: () => Promise<T>,
  maximumMs: number,
  deadline: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded its deadline.`)),
      timeoutBeforeDeadline(maximumMs, deadline, label),
    );
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Closes a pg session within cleanup grace independent of an elapsed operation deadline. */
export async function closePgClientWithGrace(
  client: PgClient,
  label: string,
  graceMs = 15_000,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded its cleanup grace.`)), graceMs);
  });
  try {
    await Promise.race([client.end(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
