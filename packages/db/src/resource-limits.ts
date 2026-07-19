import type { UserId } from "@cheatcode/types";
import { sql } from "drizzle-orm";
import { lockUserEntitlementMutations } from "./billing";
import type { Database } from "./client";
import { lockUserProjectMutations } from "./projects";

export interface EntitlementResourceLimitInput {
  maxProjects: number;
  userId: UserId;
}

export async function applyEntitlementResourceLimits(
  db: Database,
  input: EntitlementResourceLimitInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const transaction = tx as Database;
    await lockUserEntitlementMutations(transaction, input.userId);
    await reconcileProjectResourceLimit(transaction, input.userId, input.maxProjects);
  });
}

/** Uses the Vault RPC lock identity to serialize provider writes, slot reconciliation, and revalidation. */
export async function lockUserProviderKeyMutations(db: Database, userId: UserId): Promise<void> {
  const identity = `cheatcode:provider-keys:${userId}`;
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
}

async function reconcileProjectResourceLimit(
  db: Database,
  userId: UserId,
  maxProjects: number,
): Promise<void> {
  await lockUserProjectMutations(db, userId);
  await db.execute(sql`
    with ranked as (
      select
        id,
        row_number() over (order by updated_at desc, created_at desc, id desc) as rn
      from public.v2_projects
      where user_id = ${userId}
        and deleted_at is null
    )
    update public.v2_projects p
       set over_quota = ranked.rn > ${maxProjects},
           archive_after = case
             when ranked.rn > ${maxProjects}
               then coalesce(p.archive_after, now() + interval '30 days')
             else null
           end,
           updated_at = case
             when p.over_quota is distinct from (ranked.rn > ${maxProjects})
               or (ranked.rn <= ${maxProjects} and p.archive_after is not null)
             then now()
             else p.updated_at
           end
      from ranked
     where p.id = ranked.id
  `);
}
