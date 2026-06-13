"use client";

import { env } from "@cheatcode/env/web";
import {
  type BillingCancellationReason,
  BillingStateResponseSchema,
  BillingSubscriptionActionResponseSchema,
  BillingUrlResponseSchema,
  type LimitsSnapshot,
  LimitsSnapshotSchema,
  type UsageDailyTotal,
  UsageDailyTotalsResponseSchema,
} from "@cheatcode/types";
import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  DollarSign,
  Loader2,
  type LucideIcon,
  RefreshCw,
  Sparkles,
  SquareAsterisk,
  User,
  Zap,
} from "@/components/ui/icons";
import { MenuBar } from "@/components/ui/menu-bar";
import { AGENT_MODEL_OPTIONS, DEFAULT_AGENT_MODEL_ID } from "@/lib/agent-models";
import { authorizedFetch } from "@/lib/api/authorized-fetch";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";
import { IntegrationsPanel } from "./integrations-panel";
import { ProviderKeysPanel } from "./provider-keys-panel";

export type SettingsSectionId = "account" | "integrations" | "agents" | "api-keys" | "billing";

type SettingsMenuItem = {
  gradient: string;
  href: string;
  icon: LucideIcon;
  iconColor: string;
  id: SettingsSectionId;
  label: string;
};

const SETTINGS_MENU_ITEMS = [
  {
    href: "/settings/account",
    icon: User,
    gradient:
      "radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(37,99,235,0.06) 50%, rgba(29,78,216,0) 100%)",
    iconColor: "text-blue-500",
    id: "account",
    label: "Account",
  },
  {
    href: "/settings/integrations",
    icon: Zap,
    gradient:
      "radial-gradient(circle, rgba(234,179,8,0.15) 0%, rgba(202,138,4,0.06) 50%, rgba(161,98,7,0) 100%)",
    iconColor: "text-yellow-500",
    id: "integrations",
    label: "Integrations",
  },
  {
    href: "/settings/agents",
    icon: Sparkles,
    gradient:
      "radial-gradient(circle, rgba(168,85,247,0.15) 0%, rgba(147,51,234,0.06) 50%, rgba(126,34,206,0) 100%)",
    iconColor: "text-purple-500",
    id: "agents",
    label: "Agents",
  },
  {
    href: "/settings/api-keys",
    icon: SquareAsterisk,
    gradient:
      "radial-gradient(circle, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.06) 50%, rgba(185,28,28,0) 100%)",
    iconColor: "text-red-500",
    id: "api-keys",
    label: "API Keys",
  },
  {
    href: "/settings/billing",
    icon: DollarSign,
    gradient:
      "radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(5,150,105,0.06) 50%, rgba(4,120,87,0) 100%)",
    iconColor: "text-emerald-500",
    id: "billing",
    label: "Billing",
  },
] as const satisfies readonly SettingsMenuItem[];

const POLAR_PRO_MONTHLY_PRODUCT_ID = env.NEXT_PUBLIC_POLAR_PRO_MONTHLY_PRODUCT_ID;
const CANCELLATION_REASON_OPTIONS = [
  { label: "Unused", value: "unused" },
  { label: "Too expensive", value: "too_expensive" },
  { label: "Missing features", value: "missing_features" },
  { label: "Switched service", value: "switched_service" },
  { label: "Other", value: "other" },
] as const satisfies readonly { label: string; value: BillingCancellationReason }[];

export function SettingsPageClient({ activeSection }: { activeSection: SettingsSectionId }) {
  return (
    <section className="chat-scrollbar -mt-6 min-w-0 flex-1 overflow-y-auto pt-16 text-zinc-200">
      <div className="mx-auto w-full max-w-7xl px-6 py-12">
        <div className="mb-16 flex justify-center">
          <SettingsMenuBar activeSection={activeSection} />
        </div>
        <SettingsSection section={activeSection} />
      </div>
    </section>
  );
}

function SettingsMenuBar({ activeSection }: { activeSection: SettingsSectionId }) {
  const activeItem =
    SETTINGS_MENU_ITEMS.find((item) => item.id === activeSection)?.label ?? "Account";

  return (
    <div className="max-w-full overflow-x-auto">
      <MenuBar
        activeItem={activeItem}
        aria-label="Settings sections"
        items={[...SETTINGS_MENU_ITEMS]}
      />
    </div>
  );
}

function SettingsSection({ section }: { section: SettingsSectionId }) {
  if (section === "integrations") {
    return <IntegrationsPanel />;
  }
  if (section === "agents") {
    return <AgentsPanel />;
  }
  if (section === "api-keys") {
    return <ProviderKeysPanel />;
  }
  if (section === "billing") {
    return <BillingPanel />;
  }
  return <AccountPanel />;
}

function AccountPanel() {
  const { user } = useUser();
  const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? "Signed in";
  const displayName = user?.fullName ?? user?.username ?? "Cheatcode account";

  return (
    <div className="flex flex-col items-center text-zinc-200">
      <SettingsHeading
        description="Manage the account connected to this Cheatcode workspace."
        title="Account"
      />
      <div className="w-full max-w-lg space-y-6">
        <section className="space-y-6 rounded-3xl border border-zinc-800/80 bg-[#111] p-8 text-center shadow-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10 text-violet-400 ring-4 ring-violet-500/5">
            <User aria-hidden="true" className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.24em]">
              Workspace
            </p>
            <h2 className="font-medium text-white">{displayName}</h2>
            <p className="font-mono text-sm text-zinc-500">{primaryEmail}</p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <UserButton />
            <a
              className="inline-flex h-10 items-center justify-center rounded-xl px-5 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              href="/projects"
            >
              Open workspace
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function AgentsPanel() {
  const agentModelId = useAppStore((state) => state.agentModelId);
  const setAgentModelId = useAppStore((state) => state.setAgentModelId);
  const hasOverride = agentModelId !== DEFAULT_AGENT_MODEL_ID;

  return (
    <div className="flex flex-col items-center text-zinc-200">
      <SettingsHeading
        description="Set the default model and budget behavior used by Cheatcode agent runs."
        title="Agents"
      />
      <div className="w-full max-w-4xl space-y-6">
        <div className="flex items-center justify-between px-1">
          <div className="flex flex-col">
            <div className="font-bold font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em]">
              Default model
            </div>
            <p className="mt-1 text-xs text-zinc-600">
              Auto keeps the plan-defined production default.
            </p>
          </div>
          {hasOverride ? (
            <button
              aria-label="Reset agent model"
              className="inline-flex h-8 items-center rounded-full border border-zinc-800/50 px-3 font-medium text-[10px] text-zinc-500 uppercase tracking-wider transition-colors hover:bg-zinc-900 hover:text-white"
              onClick={() => setAgentModelId(DEFAULT_AGENT_MODEL_ID)}
              type="button"
            >
              <RefreshCw aria-hidden="true" className="mr-2 h-3 w-3" />
              Reset
            </button>
          ) : null}
        </div>
        <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <legend className="sr-only">Default agent model</legend>
          {AGENT_MODEL_OPTIONS.map((option) => {
            const isSelected = option.id === agentModelId;
            return (
              <label
                className={cn(
                  "group relative flex min-h-36 cursor-pointer flex-col justify-between rounded-2xl border border-zinc-800/80 bg-[#111] p-6 text-left shadow-xl transition-colors hover:border-zinc-700/80 hover:bg-[#151515]",
                  isSelected && "border-purple-500/40 bg-[#151515]",
                )}
                key={option.id}
              >
                <input
                  checked={isSelected}
                  className="sr-only"
                  name="agent-model"
                  onChange={() => setAgentModelId(option.id)}
                  type="radio"
                />
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="rounded-md border border-zinc-800/50 bg-zinc-900/50 px-2 py-0.5 font-bold font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
                      {option.label}
                    </span>
                    {isSelected ? (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]"
                      />
                    ) : null}
                  </div>
                  <p className="min-h-10 text-xs text-zinc-500 leading-relaxed">
                    {option.description}
                  </p>
                </div>
                <div
                  className={cn(
                    "mt-6 flex h-10 items-center justify-center rounded-xl border border-zinc-800/80 bg-[#0a0a0a] font-mono text-[10px] uppercase tracking-widest transition-colors",
                    isSelected ? "text-purple-300" : "text-zinc-600 group-hover:text-zinc-400",
                  )}
                >
                  {isSelected ? "Selected" : "Select"}
                </div>
              </label>
            );
          })}
        </fieldset>
      </div>
    </div>
  );
}

function BillingPanel() {
  const { getToken } = useAuth();
  const billingStateQuery = useBillingStateQuery(getToken);
  const limitsQuery = useLimitsQuery(getToken);
  const usageQuery = useUsageDailyQuery(getToken);
  const billingState = billingStateQuery.data;
  const limits = limitsQuery.data;
  const usageTotals = usageQuery.data?.totals ?? [];
  const canUpgrade = Boolean(POLAR_PRO_MONTHLY_PRODUCT_ID);

  return (
    <div className="flex flex-col items-center text-zinc-200">
      <SettingsHeading
        description="Manage the Cheatcode platform plan. Provider inference still stays bring-your-own-key."
        title="Billing"
      />
      <div className="w-full max-w-4xl space-y-6">
        <section className="rounded-3xl border border-zinc-800/80 bg-[#111] p-8 shadow-xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.24em]">
                Current quota snapshot
              </p>
              <h2 className="font-medium text-2xl text-white">
                {limitsQuery.isLoading ? "Loading limits" : "Platform limits"}
              </h2>
              <p className="max-w-xl text-sm text-zinc-500 leading-relaxed">
                Inference stays bring-your-own-key. Cheatcode billing covers the platform, project
                resources, sandbox-hours, and connected-tool usage.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 font-mono text-[10px] text-emerald-400 uppercase tracking-[0.2em]">
              {billingStateQuery.isLoading ? "Syncing" : `Plan ${billingState?.tier ?? "free"}`}
            </span>
          </div>
          <div className="mt-6 grid gap-3 rounded-2xl border border-zinc-800/70 bg-black/25 p-4 sm:grid-cols-3">
            <BillingStateCell
              label="Plan"
              value={(billingState?.tier ?? "free").replace("-", " ")}
            />
            <BillingStateCell
              label="Subscription"
              value={billingState?.subscriptionStatus ?? "none"}
            />
            <BillingStateCell
              label="Renews"
              value={dateText(billingState?.currentPeriodEnd ?? null)}
            />
          </div>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            <BillingMetric label="Projects" value={quotaText(limits, "active_projects")} />
            <BillingMetric label="Sandbox hours" value={quotaText(limits, "sandbox_hours")} />
            <BillingMetric label="Composio calls" value={quotaText(limits, "composio_calls")} />
          </div>
          {limitsQuery.isError ? (
            <p className="mt-4 text-red-300 text-xs">
              Limits are temporarily unavailable. Billing redirects still work.
            </p>
          ) : null}
          {billingStateQuery.isError ? (
            <p className="mt-4 text-red-300 text-xs">
              Billing state is temporarily unavailable. Portal access still works.
            </p>
          ) : null}
          <BillingActionGrid
            canReactivate={Boolean(billingState?.canReactivate)}
            canUpgrade={canUpgrade}
            getToken={getToken}
          />
          {billingState?.canCancel ? (
            <BillingCancellationPanel
              getToken={getToken}
              periodEnd={billingState.currentPeriodEnd}
            />
          ) : null}
          {!canUpgrade ? (
            <p className="mt-3 text-amber-300 text-xs">
              Polar product configuration is missing for this environment.
            </p>
          ) : null}
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          <BillingNote
            label="Provider costs"
            text="LLM, research, media, and browser model calls use the provider keys you add in API Keys."
          />
          <BillingNote
            label="Polar checkout"
            text="Checkout and portal sessions are created server-side through the gateway, then opened on Polar."
          />
        </section>
        <UsageHistoryPanel
          isError={usageQuery.isError}
          isLoading={usageQuery.isLoading}
          totals={usageTotals}
        />
      </div>
    </div>
  );
}

function BillingActionGrid({
  canReactivate,
  canUpgrade,
  getToken,
}: {
  canReactivate: boolean;
  canUpgrade: boolean;
  getToken: () => Promise<null | string>;
}) {
  const checkoutMutation = useBillingRedirectMutation(getToken, "checkout");
  const portalMutation = useBillingRedirectMutation(getToken, "portal");
  const reactivateMutation = useBillingActionMutation(getToken, "reactivate");

  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2">
      <button
        className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl bg-white px-5 font-medium text-black transition-colors hover:bg-zinc-200"
        disabled={checkoutMutation.isPending || !canUpgrade}
        onClick={() =>
          POLAR_PRO_MONTHLY_PRODUCT_ID
            ? checkoutMutation.mutate({
                productId: POLAR_PRO_MONTHLY_PRODUCT_ID,
                returnUrl: window.location.href,
                successUrl: window.location.href,
              })
            : toast.error("Polar product is not configured")
        }
        type="button"
      >
        {checkoutMutation.isPending ? (
          <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        {canUpgrade ? "Upgrade to Pro" : "Upgrade unavailable"}
      </button>
      <button
        className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-zinc-800 px-5 font-medium text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
        disabled={portalMutation.isPending}
        onClick={() => portalMutation.mutate(undefined)}
        type="button"
      >
        {portalMutation.isPending ? (
          <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        Manage billing
      </button>
      {canReactivate ? (
        <button
          className="inline-flex h-11 flex-1 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 font-medium text-emerald-200 transition-colors hover:bg-emerald-500/15"
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

function useLimitsQuery(getToken: () => Promise<null | string>) {
  return useQuery({
    queryFn: async () => {
      const response = await authorizedFetch(getToken, "/v1/limits");
      return LimitsSnapshotSchema.parse(await response.json());
    },
    queryKey: ["limits"],
    staleTime: 60_000,
  });
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

function useUsageDailyQuery(getToken: () => Promise<null | string>) {
  return useQuery({
    queryFn: async () => {
      const response = await authorizedFetch(getToken, "/v1/usage/daily?days=14");
      return UsageDailyTotalsResponseSchema.parse(await response.json());
    },
    queryKey: ["usage-daily", 14],
    staleTime: 60_000,
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
      ]);
    },
  });
}

function useBillingRedirectMutation(
  getToken: () => Promise<null | string>,
  action: "checkout" | "portal",
) {
  return useMutation({
    mutationFn: async (input?: { productId: string; returnUrl: string; successUrl: string }) => {
      const response = await authorizedFetch(getToken, `/v1/billing/${action}`, {
        method: "POST",
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
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

function BillingStateCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.2em]">{label}</div>
      <div className="mt-2 font-mono text-sm text-zinc-200 capitalize">{value}</div>
    </div>
  );
}

function BillingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-black/30 p-4">
      <div className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.2em]">{label}</div>
      <div className="mt-3 font-mono text-2xl text-white">{value}</div>
    </div>
  );
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

function quotaText(snapshot: LimitsSnapshot | undefined, key: string): string {
  const quota = snapshot?.quotas[key];
  if (!quota) {
    return "—";
  }
  return `${quota.used.toLocaleString()} / ${quota.limit.toLocaleString()}`;
}

function BillingNote({ label, text }: { label: string; text: string }) {
  return (
    <article className="rounded-3xl border border-zinc-800/80 bg-[#111] p-6 shadow-xl">
      <h2 className="font-medium text-white">{label}</h2>
      <p className="mt-3 text-sm text-zinc-500 leading-relaxed">{text}</p>
    </article>
  );
}

function UsageHistoryPanel({
  isError,
  isLoading,
  totals,
}: {
  isError: boolean;
  isLoading: boolean;
  totals: UsageDailyTotal[];
}) {
  const totalCost = totals.reduce((sum, row) => sum + row.totalCostUsd, 0);
  const totalRuns = totals.reduce((sum, row) => sum + row.agentRunCount, 0);
  return (
    <section className="rounded-3xl border border-zinc-800/80 bg-[#111] p-6 shadow-xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.24em]">
            Last 14 days
          </p>
          <h2 className="mt-2 font-medium text-white">Usage history</h2>
        </div>
        <div className="font-mono text-xs text-zinc-500">
          {totalRuns.toLocaleString()} runs · ${totalCost.toFixed(4)}
        </div>
      </div>
      <div className="mt-6 space-y-2">
        {isLoading ? (
          <div className="flex h-24 items-center justify-center text-zinc-600">
            <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
          </div>
        ) : isError ? (
          <p className="text-red-300 text-xs">Usage history is temporarily unavailable.</p>
        ) : totals.length === 0 ? (
          <p className="text-sm text-zinc-600">No usage has been rolled up yet.</p>
        ) : (
          totals.map((row) => <UsageHistoryRow key={row.day} row={row} />)
        )}
      </div>
    </section>
  );
}

function UsageHistoryRow({ row }: { row: UsageDailyTotal }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-zinc-800/70 bg-black/20 p-4 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div>
        <div className="font-mono text-zinc-300">{row.day}</div>
        <div className="mt-1 text-xs text-zinc-600">
          {(row.totalInputTokens + row.totalOutputTokens).toLocaleString()} tokens
        </div>
      </div>
      <div className="font-mono text-xs text-zinc-500">
        {row.agentRunCount.toLocaleString()} runs
      </div>
      <div className="font-mono text-xs text-zinc-400">${row.totalCostUsd.toFixed(4)}</div>
    </div>
  );
}

function SettingsHeading({ description, title }: { description: string; title: string }) {
  return (
    <div className="mb-10 max-w-xl space-y-6 text-center">
      <h1 className="font-medium text-2xl text-white tracking-tight">{title}</h1>
      <p className="text-sm text-zinc-500 leading-relaxed">{description}</p>
    </div>
  );
}
