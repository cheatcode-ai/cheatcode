import type { WorkerSecret } from "@cheatcode/env";
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

declare const USER_CONTEXT_DATABASE: unique symbol;

/** A transaction-pinned database that already carries a signed user context. */
export type UserContextDatabase = Database & {
  readonly [USER_CONTEXT_DATABASE]: true;
};

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

export type UserContextSource = DatabaseHandle | UserContextDatabase;

type DatabaseEnvironment =
  | {
      DATABASE_CONTEXT_SIGNING_SECRET_AGENT: WorkerSecret;
      HYPERDRIVE: HyperdriveConnection;
    }
  | {
      DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY: WorkerSecret;
      HYPERDRIVE: HyperdriveConnection;
    }
  | {
      DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS: WorkerSecret;
      HYPERDRIVE: HyperdriveConnection;
    };

export interface UserDatabaseSession {
  handle: DatabaseHandle;
  transaction: <T>(fn: (tx: UserContextDatabase) => Promise<T>) => Promise<T>;
}

type ContextSigner = ReturnType<typeof createDatabaseContextSigner>;
type CloseDatabaseHandle = (handle: DatabaseHandle) => Promise<void>;

const DATABASE_CONTEXT_SIGNERS = new WeakMap<Database, ContextSigner>();

function createDb(
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

/** Creates a request-scoped database handle that the caller must close. */
export function createDatabaseHandle(env: DatabaseEnvironment): DatabaseHandle {
  return createDb(env.HYPERDRIVE, databaseContextConfig(env));
}

export async function withUserContext<T>(
  source: UserContextSource,
  internalUserId: UserId,
  fn: (tx: UserContextDatabase) => Promise<T>,
): Promise<T> {
  const db = databaseForUserContext(source);
  const signer = DATABASE_CONTEXT_SIGNERS.get(db);
  if (!signer) {
    throw new Error("Database handle is missing its signed tenant-context configuration");
  }
  const context = await signer.sign(internalUserId);
  return db.transaction(async (tx) => {
    const transaction = tx as unknown as UserContextDatabase;
    DATABASE_CONTEXT_SIGNERS.set(transaction, signer);
    try {
      await setSignedContext(transaction, context);
      return await fn(transaction);
    } finally {
      DATABASE_CONTEXT_SIGNERS.delete(transaction);
    }
  });
}

export async function withDatabase<T>(
  env: DatabaseEnvironment,
  fn: (handle: DatabaseHandle) => Promise<T>,
  closeHandle: CloseDatabaseHandle = closeDatabaseHandle,
): Promise<T> {
  const handle = createDatabaseHandle(env);
  try {
    return await fn(handle);
  } finally {
    await closeHandle(handle);
  }
}

export async function withUserDb<T>(
  source: DatabaseEnvironment | DatabaseHandle,
  userId: UserId,
  fn: (session: UserDatabaseSession) => Promise<T>,
  closeHandle?: CloseDatabaseHandle,
): Promise<T> {
  if (isDatabaseHandle(source)) {
    return fn({
      handle: source,
      transaction: (operation) => withUserContext(source, userId, operation),
    });
  }
  return withDatabase(
    source,
    (handle) =>
      fn({
        handle,
        transaction: (operation) => withUserContext(handle, userId, operation),
      }),
    closeHandle,
  );
}

function isDatabaseHandle(source: DatabaseEnvironment | DatabaseHandle): source is DatabaseHandle {
  return "db" in source && "close" in source;
}

function databaseContextConfig(env: DatabaseEnvironment): DatabaseContextConfig {
  if ("DATABASE_CONTEXT_SIGNING_SECRET_AGENT" in env) {
    return {
      audience: "app_agent",
      signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_AGENT,
    };
  }
  if ("DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY" in env) {
    return {
      audience: "app_gateway",
      signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
    };
  }
  return {
    audience: "app_webhooks",
    signingSecret: env.DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS,
  };
}

function databaseForUserContext(source: UserContextSource): Database {
  return "db" in source && "close" in source ? source.db : source;
}

function closeDatabaseHandle(handle: DatabaseHandle): Promise<void> {
  return handle.close();
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
