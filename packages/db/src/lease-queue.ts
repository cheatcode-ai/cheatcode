import { and, eq, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { z } from "zod/v4";
import type { Database } from "./client";

const LEASE_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_CLAIMS = 25;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

type LeaseColumn<Data, NotNull extends boolean> = SQLWrapper & {
  _: { data: Data; notNull: NotNull };
};

interface LeaseQueueTable extends SQLWrapper {
  continuation: LeaseColumn<number, true>;
  failureCount: LeaseColumn<number, true>;
  lastErrorCode: LeaseColumn<string, false>;
  leaseExpiresAt: LeaseColumn<Date, false>;
  leaseToken: LeaseColumn<string, false>;
  nextAttemptAt: LeaseColumn<Date, true>;
  status: LeaseColumn<string, true>;
}

export interface LeaseQueueLease {
  continuation: number;
  leaseToken: string;
}

export interface DeferredLeaseQueueJob<Status extends string> {
  continuation: number;
  failureCount: number;
  status: Status;
}

interface DeferInput {
  errorCode: string;
}

interface QueueConfig<
  Lease extends LeaseQueueLease,
  Input extends DeferInput,
  Status extends string,
> {
  deferredStatus(failureCount: number, input: Input): Status;
  identity(lease: Lease): readonly (SQL | undefined)[];
  leaseFromContinuation(continuation: number, input: Lease & { nextLeaseToken: string }): Lease;
  normalizeErrorCode?(errorCode: string): string;
  table: LeaseQueueTable;
}

type ReservationIdentity<Lease extends LeaseQueueLease> = {
  claimIdentity?(lease: Lease): SQL | undefined;
  reservedIdentity?(lease: Lease): SQL | undefined;
};

const LeaseClaimSchema = z.object({
  continuation: z.number().int().nonnegative(),
  disposition: z.enum(["leased", "quarantined", "stale"]),
  job_id: z.string(),
  user_id: z.string(),
});

type ParsedLeaseClaim = z.output<typeof LeaseClaimSchema>;

class LeaseQueue<Lease extends LeaseQueueLease, Input extends DeferInput, Status extends string> {
  public constructor(private readonly config: QueueConfig<Lease, Input, Status>) {}

  public readonly expiryAt = leaseExpiry;

  public completionFields() {
    return { failureCount: 0, lastErrorCode: null, leaseExpiresAt: null, leaseToken: null };
  }

  public renewalFields() {
    return { leaseExpiresAt: leaseExpiry(new Date()) };
  }

  public claimIdentity(lease: Lease): SQL | undefined {
    return and(
      ...this.config.identity(lease),
      eq(this.config.table.continuation, lease.continuation),
      eq(this.config.table.status, "leased"),
      eq(this.config.table.leaseToken, lease.leaseToken),
    );
  }

  public async advanceJob(
    db: Pick<Database, "execute">,
    input: Lease,
    progressIdentity: SQL | undefined,
    assignments: SQL,
  ): Promise<boolean> {
    const result = await db.execute(sql`
      update ${this.config.table}
         set failure_count = 0, last_error_code = null, lease_expires_at = ${leaseExpiry(new Date())},
             ${assignments}
       where ${requiredIdentity(this.claimIdentity(input))}
         and ${requiredIdentity(progressIdentity)}
      returning continuation
    `);
    return result.rows.length === 1;
  }

  public reserveContinuation(
    db: Database,
    input: Lease & { nextLeaseToken: string },
    identity: ReservationIdentity<Lease> = {},
  ): Promise<Lease | null> {
    return db.transaction(async (tx) => {
      const claimIdentity = identity.claimIdentity ?? ((lease: Lease) => this.claimIdentity(lease));
      const reservedLease = this.config.leaseFromContinuation(input.continuation + 1, input);
      const result = await tx.execute(sql`
        update ${this.config.table}
           set continuation = ${this.config.table.continuation} + 1,
               lease_expires_at = ${leaseExpiry(new Date())}, lease_token = ${input.nextLeaseToken}
         where ${requiredIdentity(claimIdentity(input))} returning 1`);
      if (result.rows.length === 1) {
        return reservedLease;
      }
      const reservedIdentity =
        identity.reservedIdentity ?? ((lease: Lease) => this.claimIdentity(lease));
      const reserved = await tx.execute(sql`
        select 1 from ${this.config.table}
         where ${requiredIdentity(reservedIdentity(reservedLease))} limit 1`);
      return reserved.rows.length === 1 ? reservedLease : null;
    });
  }

  public deferJob(
    db: Database,
    input: Lease & Input,
    extraAssignment?: SQL,
  ): Promise<DeferredLeaseQueueJob<Status> | null> {
    return db.transaction(async (tx) => {
      const claim = requiredIdentity(this.claimIdentity(input));
      const result = await tx.execute(sql`
        select ${this.config.table.failureCount} as failure_count
          from ${this.config.table} where ${claim} limit 1`);
      const previousFailures = counter(result.rows[0], "failure_count");
      if (previousFailures === undefined) {
        return null;
      }
      const failureCount = previousFailures + 1;
      const status = this.config.deferredStatus(failureCount, input);
      const errorCode = this.config.normalizeErrorCode?.(input.errorCode) ?? input.errorCode;
      const nextAttemptAt = new Date(Date.now() + retryDelayMs(failureCount));
      const extra = extraAssignment ? sql`, ${extraAssignment}` : sql``;
      const updated = await tx.execute(sql`
        update ${this.config.table}
           set continuation = ${input.continuation + 1}, failure_count = ${failureCount},
               last_error_code = ${errorCode}, lease_expires_at = null, lease_token = null,
               next_attempt_at = ${nextAttemptAt}, status = ${status} ${extra}
         where ${claim} returning 1`);
      return updated.rows.length !== 1
        ? null
        : { continuation: input.continuation + 1, failureCount, status };
    });
  }

  public async quarantineJob(db: Database, input: Lease & { errorCode: string }): Promise<boolean> {
    const result = await db.execute(sql`
      update ${this.config.table}
         set failure_count = ${this.config.table.failureCount} + 1,
             last_error_code = ${input.errorCode}, lease_expires_at = null,
             lease_token = null, status = 'quarantined'
       where ${requiredIdentity(this.claimIdentity(input))} returning continuation`);
    return result.rows.length === 1;
  }
}

export function createLeaseQueue<
  Lease extends LeaseQueueLease,
  Input extends DeferInput,
  const Status extends string,
>(config: QueueConfig<Lease, Input, Status>) {
  return new LeaseQueue(config);
}

export function boundedLeaseLimit(limit: number | undefined, shouldTruncate = true): number {
  const candidate = shouldTruncate ? Math.trunc(limit ?? MAX_CLAIMS) : limit;
  return Math.max(1, Math.min(candidate ?? MAX_CLAIMS, MAX_CLAIMS));
}

export function partitionLeaseClaims(rows: readonly Record<string, unknown>[]): {
  leased: ParsedLeaseClaim[];
  quarantinedJobIds: string[];
  stale: number;
} {
  const claims = rows.map((row) => LeaseClaimSchema.parse(row));
  return {
    leased: claims.filter((claim) => claim.disposition === "leased"),
    quarantinedJobIds: claims
      .filter((claim) => claim.disposition === "quarantined")
      .map((claim) => claim.job_id),
    stale: claims.filter((claim) => claim.disposition === "stale").length,
  };
}

function requiredIdentity(identity: SQL | undefined): SQL {
  if (!identity) {
    throw new Error("Lease queue identity must include at least one condition");
  }
  return identity;
}

function counter(row: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = row?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + LEASE_DURATION_MS);
}

function retryDelayMs(failureCount: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 30_000 * 2 ** Math.min(failureCount - 1, 10));
}
