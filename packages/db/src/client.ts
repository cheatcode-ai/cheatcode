import type { UserId } from "@cheatcode/types";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  createDatabaseContextSigner,
  type DatabaseContextConfig,
  type SignedDatabaseContext,
} from "./database-context";
import * as schema from "./schema";

export interface HyperdriveConnection {
  connectionString: string;
}

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

type ContextSigner = ReturnType<typeof createDatabaseContextSigner>;

const DATABASE_CONTEXT_SIGNERS = new WeakMap<Database, ContextSigner>();

export function createDb(
  hyperdrive: HyperdriveConnection,
  contextConfig: DatabaseContextConfig,
): DatabaseHandle {
  const pool = new Pool({
    connectionString: hyperdrive.connectionString,
    // A handle is request-scoped and user work is transaction-pinned. Hyperdrive
    // owns the upstream pool, so opening five driver connections here only burns
    // Worker connection slots without adding query concurrency.
    max: 1,
  });

  const db = drizzle(pool, { schema });
  DATABASE_CONTEXT_SIGNERS.set(db, createDatabaseContextSigner(contextConfig));
  return { db, close: () => closeDatabase(db, pool) };
}

export async function withUserContext<T>(
  db: Database,
  internalUserId: UserId,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  const signer = DATABASE_CONTEXT_SIGNERS.get(db);
  if (!signer) {
    throw new Error("Database handle is missing its signed tenant-context configuration");
  }
  const context = await signer.sign(internalUserId);
  return db.transaction(async (tx) => {
    const transaction = tx as Database;
    DATABASE_CONTEXT_SIGNERS.set(transaction, signer);
    try {
      await setSignedContext(transaction, context);
      return await fn(transaction);
    } finally {
      DATABASE_CONTEXT_SIGNERS.delete(transaction);
    }
  });
}

async function setSignedContext(db: Database, context: SignedDatabaseContext): Promise<void> {
  await db.execute(sql`
    select
      set_config('app.user_id', ${context.userId}, true),
      set_config('app.context_issued_at', ${context.issuedAt}, true),
      set_config('app.context_nonce', ${context.nonce}, true),
      set_config('app.context_signature', ${context.signature}, true)
  `);
}

async function closeDatabase(db: Database, pool: Pool): Promise<void> {
  DATABASE_CONTEXT_SIGNERS.delete(db);
  await pool.end();
}
