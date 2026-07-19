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

/**
 * Loads plaintext only when the claimed fingerprint still identifies the current enabled key.
 * The caller must finish and release its user-context transaction before provider I/O.
 */
export async function getProviderKeyForRevalidation(
  tx: Database,
  provider: Provider,
  expectedFingerprint: string,
  expectedLeaseToken: string,
): Promise<string | null> {
  const result = await tx.execute(sql`
    select public.get_provider_key(${provider}) as key
     where exists (
       select 1
         from public.v2_provider_keys candidate
        where candidate.user_id = public.current_app_user()
          and candidate.provider = ${provider}
          and candidate.fingerprint = ${expectedFingerprint}
          and candidate.revalidation_lease_token = ${expectedLeaseToken}
          and candidate.revalidation_claimed_at >= now() - interval '15 minutes'
          and candidate.disabled_at is null
     )
  `);
  const rows = result.rows as Array<{ key: string | null }>;
  return rows[0]?.key ?? null;
}

export async function deleteProviderKey(tx: Database, provider: Provider): Promise<void> {
  await tx.execute(sql`select delete_provider_key(${provider})`);
}

export async function listProviderKeys(tx: Database): Promise<ProviderKeySummary[]> {
  const rows = await tx.query.providerKeys.findMany({
    columns: {
      disabledAt: true,
      disabledReason: true,
      provider: true,
    },
  });

  return rows.map((row) => ({
    disabledAt: row.disabledAt?.toISOString() ?? null,
    disabledReason: row.disabledReason,
    provider: ProviderSchema.parse(row.provider),
  }));
}
