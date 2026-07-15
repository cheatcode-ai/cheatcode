import type { Client } from "pg";

export type DrizzleMigrationClient = Client;

export interface DrizzleMigrationPlan {
  checksum: string;
  file: string;
  statements: readonly string[];
  when: string;
}

const DRIZZLE_SCHEMA = "drizzle";
const DRIZZLE_TABLE = "__drizzle_migrations";

/** Apply each pending Drizzle file in its own transaction to bound DDL lock lifetime. */
export async function runDrizzleMigrations(
  client: DrizzleMigrationClient,
  migrations: readonly DrizzleMigrationPlan[],
  report: (message: string) => void,
): Promise<void> {
  await ensureDrizzleLedger(client);
  for (const migration of migrations) {
    report(`apply drizzle: ${migration.file}`);
    await applyDrizzleMigration(client, migration);
  }
}

async function ensureDrizzleLedger(client: DrizzleMigrationClient): Promise<void> {
  await client.query(`create schema if not exists ${DRIZZLE_SCHEMA}`);
  await client.query(
    `create table if not exists ${DRIZZLE_SCHEMA}.${DRIZZLE_TABLE} (
      id serial primary key,
      hash text not null,
      created_at bigint
    )`,
  );
}

async function applyDrizzleMigration(
  client: DrizzleMigrationClient,
  migration: DrizzleMigrationPlan,
): Promise<void> {
  await client.query("begin");
  try {
    for (const statement of migration.statements) {
      if (statement.trim()) {
        await client.query(statement);
      }
    }
    await client.query(
      `insert into ${DRIZZLE_SCHEMA}.${DRIZZLE_TABLE} (hash, created_at) values ($1, $2)`,
      [migration.checksum, migration.when],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
