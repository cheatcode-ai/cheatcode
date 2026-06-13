import type { Database } from "@cheatcode/db";
import { providerKeys } from "@cheatcode/db/schema";
import type { Provider, ProviderKeySummary } from "@cheatcode/types";
import { sql } from "drizzle-orm";

export { validateProviderKey } from "./provider-validation";

export async function setProviderKey(tx: Database, provider: Provider, key: string): Promise<void> {
  await tx.execute(sql`select set_provider_key(${provider}, ${key})`);
}

export async function getProviderKey(tx: Database, provider: Provider): Promise<string | null> {
  const result = await tx.execute(sql`select get_provider_key(${provider}) as key`);
  const rows = result.rows as Array<{ key: string | null }>;
  return rows[0]?.key ?? null;
}

export async function deleteProviderKey(tx: Database, provider: Provider): Promise<void> {
  await tx.execute(sql`select delete_provider_key(${provider})`);
}

export async function listProviderKeys(tx: Database): Promise<ProviderKeySummary[]> {
  const rows = await tx.query.providerKeys.findMany({
    where: (key, { isNull }) => isNull(key.deletedAt),
    columns: {
      disabledAt: true,
      disabledReason: true,
      provider: true,
      fingerprint: true,
      lastUsedAt: true,
    },
  });

  return rows.map((row) => ({
    disabledAt: row.disabledAt?.toISOString() ?? null,
    disabledReason: row.disabledReason,
    provider: row.provider as Provider,
    fingerprint: row.fingerprint,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function hasProviderKey(tx: Database, provider: Provider): Promise<boolean> {
  const row = await tx.query.providerKeys.findFirst({
    where: (key, { and, eq, isNull }) =>
      and(eq(key.provider, provider), isNull(providerKeys.deletedAt), isNull(key.disabledAt)),
    columns: {
      id: true,
    },
  });
  return row !== undefined;
}
