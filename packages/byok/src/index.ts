import type { Database } from "@cheatcode/db";
import { type Provider, type ProviderKeySummary, ProviderSchema } from "@cheatcode/types";
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
    provider: ProviderSchema.parse(row.provider),
    fingerprint: row.fingerprint,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}
