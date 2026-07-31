import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRawDatabaseContextSigner } from "../packages/db/src/database-context-signer";
import {
  assertPinnedDatabaseIdentity,
  configureDatabaseOperationSession,
  type DatabaseIdentityExpectation,
} from "./database-operation-safety";
import { loadDrizzleMigrations, verifyDrizzleMigrationIntegrity } from "./migration-drizzle";
import type { PgClient } from "./pg-client";

interface PgModule {
  Client: new (config: { connectionString: string }) => PgClient;
}

export interface AdminDatabaseIdentity {
  database: string;
  role: string;
  systemIdentifier: string;
}

export interface RuntimeDatabaseCredentials {
  databaseUrl: string;
  role: RuntimeRole;
  signingSecret: string;
}

export interface DatabaseProvisionInput {
  adminDatabaseUrl: string;
  runtimeCredentials: readonly RuntimeDatabaseCredentials[];
  rolePasswords: Readonly<Record<RuntimeRole, string>>;
}

type RuntimeRole = "app_agent" | "app_gateway" | "app_webhooks";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VAULT_SECRET_CONTRACT: Readonly<Record<RuntimeRole, { description: string; name: string }>> =
  {
    app_agent: {
      description: "Cheatcode signed tenant context HMAC for app_agent",
      name: "cheatcode-database-context-app-agent-v1",
    },
    app_gateway: {
      description: "Cheatcode signed tenant context HMAC for app_gateway",
      name: "cheatcode-database-context-app-gateway-v1",
    },
    app_webhooks: {
      description: "Cheatcode signed tenant context HMAC for app_webhooks",
      name: "cheatcode-database-context-app-webhooks-v1",
    },
  };

export async function readAdminDatabaseIdentity(
  databaseUrl: string,
): Promise<AdminDatabaseIdentity> {
  return withClient(databaseUrl, "cheatcode-setup-identity", async (client) => {
    const result = await client.query(
      `select current_database() as database,
              current_user as role,
              (select system_identifier::text from pg_control_system()) as system_identifier`,
    );
    const row = result.rows[0];
    return {
      database: requiredString(row, "database", "database identity"),
      role: requiredString(row, "role", "database identity"),
      systemIdentifier: requiredString(row, "system_identifier", "database identity"),
    };
  });
}

export async function provisionDatabase(input: DatabaseProvisionInput): Promise<void> {
  await withClient(input.adminDatabaseUrl, "cheatcode-setup-provision", async (client) => {
    for (const credential of input.runtimeCredentials) {
      await setRolePassword(client, credential.role, input.rolePasswords[credential.role]);
      await upsertContextSecret(client, credential.role, credential.signingSecret);
    }
  });
}

export async function verifyDatabaseSetup(
  credentials: readonly RuntimeDatabaseCredentials[],
): Promise<void> {
  await Promise.all(credentials.map(verifyRuntimeCredential));
}

export async function verifyMigrationLedger(
  databaseUrl: string,
  expectation: DatabaseIdentityExpectation,
): Promise<void> {
  await withClient(databaseUrl, "cheatcode-setup-check", async (client) => {
    await assertPinnedDatabaseIdentity(client, expectation, "dry-run");
    const migrations = await loadDrizzleMigrations();
    const applied = await verifyDrizzleMigrationIntegrity(client, migrations);
    if (applied.size !== migrations.length) {
      throw new Error(
        `Migration ledger has ${migrations.length - applied.size} pending migration(s); run pnpm dev:setup.`,
      );
    }
  });
}

async function setRolePassword(
  client: PgClient,
  role: RuntimeRole,
  password: string,
): Promise<void> {
  const formatted = await client.query(
    "select pg_catalog.format('ALTER ROLE %I WITH PASSWORD %L', $1, $2) as statement",
    [role, password],
  );
  const statement = requiredString(formatted.rows[0], "statement", `${role} password statement`);
  await client.query(statement);
}

async function upsertContextSecret(
  client: PgClient,
  role: RuntimeRole,
  plaintext: string,
): Promise<void> {
  const contract = VAULT_SECRET_CONTRACT[role];
  const existing = await client.query("select id::text from vault.secrets where name = $1", [
    contract.name,
  ]);
  if (existing.rows.length > 1) {
    throw new Error(`Vault contains duplicate ${contract.name} rows.`);
  }
  const id = optionalString(existing.rows[0], "id");
  if (id) {
    await client.query("select vault.update_secret($1::uuid, $2, $3, $4)", [
      id,
      plaintext,
      contract.name,
      contract.description,
    ]);
    return;
  }
  await client.query("select vault.create_secret($1, $2, $3)", [
    plaintext,
    contract.name,
    contract.description,
  ]);
}

async function verifyRuntimeCredential(input: RuntimeDatabaseCredentials): Promise<void> {
  await withClient(input.databaseUrl, "cheatcode-setup-probe", async (client) => {
    const userId = crypto.randomUUID();
    const signer = createRawDatabaseContextSigner({
      audience: input.role,
      loadSecret: async () => input.signingSecret,
    });
    const context = await signer.sign(userId);
    await client.query("begin");
    try {
      await setSignedContext(client, context);
      const result = await client.query("select public.current_app_user()::text as user_id");
      if (requiredString(result.rows[0], "user_id", `${input.role} signed context`) !== userId) {
        throw new Error(`${input.role} signed-context probe returned the wrong user.`);
      }
    } finally {
      await client.query("rollback");
    }
  });
}

async function setSignedContext(
  client: PgClient,
  context: { issuedAt: string; nonce: string; signature: string; userId: string },
): Promise<void> {
  await client.query(
    `select set_config('app.user_id', $1, true),
            set_config('app.context_issued_at', $2, true),
            set_config('app.context_nonce', $3, true),
            set_config('app.context_signature', $4, true)`,
    [context.userId, context.issuedAt, context.nonce, context.signature],
  );
}

async function withClient<T>(
  databaseUrl: string,
  applicationName: string,
  operation: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = createClient(databaseUrl);
  await client.connect();
  try {
    await configureDatabaseOperationSession(client, {
      applicationName,
      statementTimeout: "2min",
    });
    return await operation(client);
  } finally {
    await client.end();
  }
}

function createClient(databaseUrl: string): PgClient {
  const dbRequire = createRequire(join(ROOT, "packages/db/package.json"));
  const { Client } = dbRequire("pg") as PgModule;
  return new Client({ connectionString: databaseUrl });
}

function requiredString(
  row: Record<string, unknown> | undefined,
  key: string,
  label: string,
): string {
  const value = optionalString(row, key);
  if (!value) {
    throw new Error(`Unable to read ${label}.`);
  }
  return value;
}

function optionalString(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" ? value : undefined;
}
