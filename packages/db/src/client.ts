import type { UserId } from "@cheatcode/types";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export interface HyperdriveConnection {
  connectionString: string;
}

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDb(hyperdrive: HyperdriveConnection): DatabaseHandle {
  const pool = new Pool({
    connectionString: hyperdrive.connectionString,
    // A handle is request-scoped and user work is transaction-pinned. Hyperdrive
    // owns the upstream pool, so opening five driver connections here only burns
    // Worker connection slots without adding query concurrency.
    max: 1,
  });

  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}

export async function withUserContext<T>(
  db: Database,
  internalUserId: UserId,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${internalUserId}, true)`);
    return fn(tx as Database);
  });
}
