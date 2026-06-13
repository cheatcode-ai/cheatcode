"use client";

import {
  type BillingCancellationReason,
  BillingStateResponseSchema,
  BillingSubscriptionActionResponseSchema,
  type BillingTier,
  BillingUrlResponseSchema,
  type PaidBillingTier,
  type PlanSummary,
  type SandboxUsageSummaryResponse,
  type SandboxUsageWarnLevel,
  type UsageRunPoint,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "@/components/ui/icons";
import { authorizedFetch } from "@/lib/api/authorized-fetch";
import { requestCheckout } from "@/lib/api/billing";
import {
  BILLING_CATALOG_QUERY_KEY,
  formatHoursTotal,
  formatHoursUsed,
  SANDBOX_USAGE_QUERY_KEY,
  useBillingCatalogQuery,
  useSandboxUsageQuery,
  useUsageDailyQuery,
} from "@/lib/hooks/use-billing";
import { cn } from "@/lib/ui/cn";
import { SettingsHeading } from "./settings-heading";

const ACTIVITY_RANGE_OPTIONS = [7, 14, 28] as const;
const CANCELLATION_REASON_OPTIONS = [
  { label: "Unused", value: "unused" },
  { label: "Too expensive", value: "too_expensive" },
  { label: "Missing features", value: "missing_features" },
  { label: "Switched service", value: "switched_service" },
  { label: "Other", value: "other" },
] as const satisfies readonly { label: string; value: BillingCancellationReason }[];

const WARN_BAR_CLASS: Record<SandboxUsageWarnLevel, string> = {
  exhausted: "bg-red-500",
  none: "bg-emerald-500",
  warn80: "bg-amber-500",
  warn95: "bg-orange-500",
};

export function BillingPanel() {
  const { getToken } = useAuth();

  return (
    <div className="flex flex-col items-center text-zinc-200">
      <SettingsHeading
        description="Cheatcode bills sandbox hours per month. Provider inference still stays bring-your-own-key."
        title="Billing"
      />
      <div className="w-full max-w-4xl space-y-6">
        <SandboxHoursMeter getToken={getToken} />
        <PlanCatalogSection getToken={getToken} />
        <ManageSubscriptionSection getToken={getToken} />
        <ActivitySection getToken={getToken} />
      </div>
    </div>
  );
}

function SandboxHoursMeter({ getToken }: { getToken: () => Promise<null | string> }) {
  const usageQuery = useSandboxUsageQuery(getToken);
  const usage = usageQuery.data;

  return (
    <section className="rounded-3xl border border-zinc-800/80 bg-[#111] p-8 shadow-xl">
      <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.24em]">
        Time remaining
      </p>
      {usageQuery.isLoading ? (
        <p className="mt-3 text-sm text-zinc-500">Loading sandbox usage…</p>
      ) : usageQuery.isError || !usage ? (
        <p className="mt-3 text-red-300 text-xs">Sandbox usage is temporarily unavailable.</p>
      ) : (
        <SandboxHoursMeterBody usage={usage} />
      )}
    </section>
  );
}

function SandboxHoursMeterBody({ usage }: { usage: SandboxUsageSummaryResponse }) {
  const remaining = Math.max(0, usage.sandboxHoursTotal - usage.sandboxHoursUsed);
  const fraction =
    usage.sandboxHoursTotal > 0 ? Math.min(1, usage.sandboxHoursUsed / usage.sandboxHoursTotal) : 0;

  return (
    <>
      <p className="mt-3 font-medium text-2xl text-white">
        {formatHoursUsed(usage.sandboxHoursUsed)} of {formatHoursTotal(usage.sandboxHoursTotal)}{" "}
        hours
      </p>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/40">
        <div
          className={cn("h-full", WARN_BAR_CLASS[usage.warnLevel])}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-zinc-500">
        {formatHoursUsed(remaining)} hours remaining on the {usage.tier} plan · Resets{" "}
        {dateText(usage.resetAt)}
      </p>
    </>
  );
}

function PlanCatalogSection({ getToken }: { getToken: () => Promise<null | string> }) {
  const catalogQuery = useBillingCatalogQuery(getToken);
  const plans = catalogQuery.data?.plans ?? [];

  return (
    <section className="space-y-4">
      <h2 className="font-medium text-white">Plans</h2>
      {catalogQuery.isLoading ? (
        <p className="text-sm text-zinc-500">Loading plans…</p>
      ) : catalogQuery.isError ? (
        <p className="text-red-300 text-xs">Plans are temporarily unavailable.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard getToken={getToken} key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </section>
  );
}

function PlanCard({
  getToken,
  plan,
}: {
  getToken: () => Promise<null | string>;
  plan: PlanSummary;
}) {
  const checkoutMutation = useCheckoutMutation(getToken);
  const paidTier = paidTierOf(plan.id);

  return (
    <article
      className={cn(
        "flex flex-col rounded-3xl border bg-[#111] p-6 shadow-xl",
        plan.current ? "border-emerald-500/40" : "border-zinc-800/80",
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-white">{plan.displayName}</h3>
        {plan.current ? (
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-400 uppercase tracking-[0.2em]">
            Current
          </span>
        ) : null}
      </div>
      <p className="mt-3 font-mono text-3xl text-white">${plan.monthlyPriceUsd}</p>
      <p className="text-xs text-zinc-600">per month</p>
      <ul className="mt-4 flex-1 space-y-1.5 text-sm text-zinc-400">
        <li>{plan.sandboxHoursPerMonth} sandbox hours / month</li>
        <li>{capText(plan.limits.maxProjects, "projects")}</li>
        <li>{plan.limits.maxConcurrentSandboxes} concurrent sandboxes</li>
        <li>{capText(plan.limits.quotaComposioCalls, "Composio calls")}</li>
      </ul>
      <PlanCardAction
        isPending={checkoutMutation.isPending}
        onCheckout={(tier) => checkoutMutation.mutate(tier)}
        paidTier={paidTier}
        plan={plan}
      />
    </article>
  );
}

function PlanCardAction({
  isPending,
  onCheckout,
  paidTier,
  plan,
}: {
  isPending: boolean;
  onCheckout: (tier: PaidBillingTier) => void;
  paidTier: PaidBillingTier | null;
  plan: PlanSummary;
}) {
  if (plan.current) {
    return <PlanCardButtonLabel disabled label="Current plan" />;
  }
  if (paidTier === null) {
    return <PlanCardButtonLabel disabled label="Bring your own key" />;
  }
  if (!plan.available) {
    return <PlanCardButtonLabel disabled label="Unavailable" />;
  }
  return (
    <button
      className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-white px-5 font-medium text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isPending}
      onClick={() => onCheckout(paidTier)}
      type="button"
    >
      {isPending ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : null}
      Get {plan.displayName}
    </button>
  );
}

function PlanCardButtonLabel({ disabled, label }: { disabled: boolean; label: string }) {
  return (
    <button
      className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-800 px-5 font-medium text-zinc-500"
      disabled={disabled}
      type="button"
    >
      {label}
    </button>
  );
}

function ManageSubscriptionSection({ getToken }: { getToken: () => Promise<null | string> }) {
  const billingStateQuery = useBillingStateQuery(getToken);
  const billingState = billingStateQuery.data;

  return (
    <section className="rounded-3xl border border-zinc-800/80 bg-[#111] p-8 shadow-xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.24em]">
            Subscription
          </p>
          <h2 className="font-medium text-white">Manage subscription</h2>
        </div>
        <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 font-mono text-[10px] text-emerald-400 uppercase tracking-[0.2em]">
          {billingStateQuery.isLoading ? "Syncing" : `Plan ${billingState?.tier ?? "free"}`}
        </span>
      </div>
      <div className="mt-6 grid gap-3 rounded-2xl border border-zinc-800/70 bg-black/25 p-4 sm:grid-cols-3">
        <BillingStateCell label="Plan" value={billingState?.tier ?? "free"} />
        <BillingStateCell label="Subscription" value={billingState?.subscriptionStatus ?? "none"} />
        <BillingStateCell label="Renews" value={dateText(billingState?.currentPeriodEnd ?? null)} />
      </div>
      {billingStateQuery.isError ? (
        <p className="mt-4 text-red-300 text-xs">
          Billing state is temporarily unavailable. Portal access still works.
        </p>
      ) : null}
      <BillingActionGrid canReactivate={Boolean(billingState?.canReactivate)} getToken={getToken} />
      {billingState?.canCancel ? (
        <BillingCancellationPanel getToken={getToken} periodEnd={billingState.currentPeriodEnd} />
      ) : null}
    </section>
  );
}

function BillingActionGrid({
  canReactivate,
  getToken,
}: {
  canReactivate: boolean;
  getToken: () => Promise<null | string>;
}) {
  const portalMutation = usePortalMutation(getToken);
  const reactivateMutation = useBillingActionMutation(getToken, "reactivate");

  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2">
      <button
        className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-800 px-5 font-medium text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
        disabled={portalMutation.isPending}
        onClick={() => portalMutation.mutate()}
        type="button"
      >
        {portalMutation.isPending ? (
          <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        Manage billing
      </button>
      {canReactivate ? (
        <button
          className="inline-flex h-11 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 font-medium text-emerald-200 transition-colors hover:bg-emerald-500/15"
          disabled={reactivateMutation.isPending}
          onClick={() => reactivateMutation.mutate(undefined)}
          type="button"
        >
          {reactivateMutation.isPending ? (
            <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
          )}
          Reactivate plan
        </button>
      ) : null}
    </div>
  );
}

function BillingCancellationPanel({
  getToken,
  periodEnd,
}: {
  getToken: () => Promise<null | string>;
  periodEnd: string | null;
}) {
  const [cancelComment, setCancelComment] = useState("");
  const [cancelReason, setCancelReason] = useState<BillingCancellationReason>("unused");
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const cancelMutation = useBillingActionMutation(getToken, "cancel", () => {
    setIsCancelOpen(false);
    setCancelComment("");
  });

  return (
    <>
      <button
        className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-zinc-800 px-5 font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white"
        onClick={() => setIsCancelOpen((value) => !value)}
        type="button"
      >
        Cancel plan
      </button>
      {isCancelOpen ? (
        <div className="mt-5 rounded-2xl border border-zinc-800/80 bg-black/30 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-medium text-white">Cancel at period end</h3>
              <p className="mt-1 text-sm text-zinc-500">
                Access remains active until {dateText(periodEnd)}.
              </p>
            </div>
            <button
              className="rounded-xl px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-white"
              onClick={() => setIsCancelOpen(false)}
              type="button"
            >
              Keep plan
            </button>
          </div>
          <fieldset className="mt-5 grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Cancellation reason</legend>
            {CANCELLATION_REASON_OPTIONS.map((option) => (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors",
                  cancelReason === option.value
                    ? "border-purple-500/40 bg-purple-500/10 text-white"
                    : "border-zinc-800 bg-[#0b0b0b] text-zinc-400 hover:border-zinc-700",
                )}
                key={option.value}
              >
                <input
                  checked={cancelReason === option.value}
                  className="h-4 w-4 accent-purple-500"
                  name="cancel-reason"
                  onChange={() => setCancelReason(option.value)}
                  type="radio"
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <textarea
            className="mt-3 min-h-24 w-full resize-none rounded-2xl border border-zinc-800 bg-[#080808] px-4 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-zinc-700"
            maxLength={1000}
            onChange={(event) => setCancelComment(event.target.value)}
            placeholder="Optional feedback"
            value={cancelComment}
          />
          <button
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 px-5 font-medium text-red-200 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={cancelMutation.isPending}
            onClick={() => {
              const comment = cancelComment.trim();
              cancelMutation.mutate({
                ...(comment ? { comment } : {}),
                reason: cancelReason,
              });
            }}
            type="button"
          >
            {cancelMutation.isPending ? (
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Confirm cancellation
          </button>
        </div>
      ) : null}
    </>
  );
}

function ActivitySection({ getToken }: { getToken: () => Promise<null | string> }) {
  const [days, setDays] = useState<number>(14);
  const usageQuery = useUsageDailyQuery(getToken, days);
  const runs = usageQuery.data?.runs ?? [];
  const truncated = usageQuery.data?.truncated ?? false;
  const totals = usageQuery.data?.totals ?? [];
  const totalCost = totals.reduce((sum, row) => sum + row.totalCostUsd, 0);

  return (
    <section className="rounded-3xl border border-zinc-800/80 bg-[#111] p-6 shadow-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.24em]">
            Last {days} days
          </p>
          <h2 className="mt-2 font-medium text-white">Activity</h2>
        </div>
        <div className="flex items-center gap-2">
          {ACTIVITY_RANGE_OPTIONS.map((option) => (
            <button
              className={cn(
                "rounded-lg border px-3 py-1.5 font-mono text-[11px] transition-colors",
                option === days
                  ? "border-zinc-600 bg-zinc-800 text-white"
                  : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
              )}
              key={option}
              onClick={() => setDays(option)}
              type="button"
            >
              {option}d
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 font-mono text-xs text-zinc-500">
        {runs.length.toLocaleString()} runs · ${totalCost.toFixed(4)}
      </p>
      <div className="mt-6 space-y-2">
        {usageQuery.isLoading ? (
          <div className="flex h-24 items-center justify-center text-zinc-600">
            <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
          </div>
        ) : usageQuery.isError ? (
          <p className="text-red-300 text-xs">Activity is temporarily unavailable.</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-zinc-600">No runs started in this range.</p>
        ) : (
          runs.map((run) => <ActivityRow key={run.runId} run={run} />)
        )}
      </div>
      {truncated ? (
        <p className="mt-4 text-amber-300 text-xs">
          Showing the most recent runs only; older runs in this range were truncated.
        </p>
      ) : null}
    </section>
  );
}

function ActivityRow({ run }: { run: UsageRunPoint }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-zinc-800/70 bg-black/20 p-4 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="truncate font-mono text-xs text-zinc-600">{run.runId}</div>
      <div className="font-mono text-zinc-300">{timestampText(run.startedAt)}</div>
      <div className="font-mono text-xs text-zinc-400">{run.status}</div>
    </div>
  );
}

function useBillingStateQuery(getToken: () => Promise<null | string>) {
  return useQuery({
    queryFn: async () => {
      const response = await authorizedFetch(getToken, "/v1/billing/state");
      return BillingStateResponseSchema.parse(await response.json());
    },
    queryKey: ["billing-state"],
    staleTime: 60_000,
  });
}

function useCheckoutMutation(getToken: () => Promise<null | string>) {
  return useMutation({
    mutationFn: (tier: PaidBillingTier) =>
      requestCheckout(getToken, {
        returnUrl: window.location.href,
        successUrl: window.location.href,
        tier,
      }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Checkout failed");
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}

function usePortalMutation(getToken: () => Promise<null | string>) {
  return useMutation({
    mutationFn: async () => {
      const response = await authorizedFetch(getToken, "/v1/billing/portal", { method: "POST" });
      return BillingUrlResponseSchema.parse(await response.json()).url;
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Billing redirect failed");
    },
    onSuccess: (url) => {
      window.location.assign(url);
    },
  });
}

function useBillingActionMutation(
  getToken: () => Promise<null | string>,
  action: "cancel" | "reactivate",
  onDone?: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input?: { comment?: string; reason?: BillingCancellationReason } | undefined,
    ) => {
      const response = await authorizedFetch(getToken, `/v1/billing/${action}`, {
        method: "POST",
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      return BillingSubscriptionActionResponseSchema.parse(await response.json());
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Billing update failed");
    },
    onSuccess: async (result) => {
      toast.success(result.cancelAtPeriodEnd ? "Plan cancellation scheduled" : "Plan reactivated");
      onDone?.();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["billing-state"] }),
        queryClient.invalidateQueries({ queryKey: ["limits"] }),
        queryClient.invalidateQueries({ queryKey: SANDBOX_USAGE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: BILLING_CATALOG_QUERY_KEY }),
      ]);
    },
  });
}

function BillingStateCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.2em]">{label}</div>
      <div className="mt-2 font-mono text-sm text-zinc-200 capitalize">{value}</div>
    </div>
  );
}

function paidTierOf(id: BillingTier): PaidBillingTier | null {
  return id === "free" ? null : id;
}

function capText(value: number | null, noun: string): string {
  return value === null ? `Unlimited ${noun}` : `${value.toLocaleString()} ${noun}`;
}

function dateText(value: string | null): string {
  if (!value) {
    return "Not scheduled";
  }
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function timestampText(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}
