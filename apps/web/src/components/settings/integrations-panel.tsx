"use client";

import type { Integration, IntegrationName } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, Trash2, Zap } from "@/components/ui/icons";
import {
  connectIntegration,
  disconnectIntegration,
  INTEGRATIONS_QUERY,
  listIntegrations,
} from "@/lib/api/integrations";
import { cn } from "@/lib/ui/cn";

const STATUS_LABELS: Record<Integration["status"], string> = {
  active: "Connected",
  expired: "Expired",
  failed: "Failed",
  inactive: "Inactive",
  initiating: "Connecting",
  not_connected: "Not connected",
};
const LOADING_INTEGRATION_NAMES = ["github", "gmail", "slack", "notion", "linear"] as const;

export function IntegrationsPanel() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const integrationsQuery = useIntegrationsQuery(getToken);
  const connectMutation = useConnectIntegration(getToken);
  const disconnectMutation = useDisconnectIntegration(getToken, queryClient);
  const integrations = integrationsQuery.data ?? [];

  return (
    <div className="text-[#1b1b1b]">
      <div className="mb-6">
        <h1 className="font-bold text-[30px] tracking-[-0.01em]">Integrations</h1>
        <p className="mt-3 text-[#4f4f4f] text-[18px] leading-7">
          Connect OAuth tools for agent actions. Connections are routed through Composio and
          executed server-side by V2 workers.
        </p>
      </div>
      <div className="grid w-full gap-4 md:grid-cols-2">
        {integrationsQuery.isPending ? (
          <IntegrationsLoading />
        ) : (
          integrations.map((integration) => (
            <IntegrationCard
              disconnectingName={disconnectMutation.variables}
              integration={integration}
              isConnecting={
                connectMutation.isPending && connectMutation.variables === integration.name
              }
              isDisconnecting={
                disconnectMutation.isPending && disconnectMutation.variables === integration.name
              }
              key={integration.name}
              onConnect={() => connectMutation.mutate(integration.name)}
              onDisconnect={() => disconnectMutation.mutate(integration.name)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function IntegrationCard({
  disconnectingName,
  integration,
  isConnecting,
  isDisconnecting,
  onConnect,
  onDisconnect,
}: {
  disconnectingName: IntegrationName | undefined;
  integration: Integration;
  isConnecting: boolean;
  isDisconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const isActive = integration.status === "active";
  const isBusy = isConnecting || isDisconnecting;
  const isOtherDisconnecting = Boolean(disconnectingName && disconnectingName !== integration.name);

  return (
    <section className="rounded-[22px] border border-[#f1f1f1] bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <IntegrationMark isActive={isActive} />
            <h2 className="font-semibold text-[#1b1b1b]">{integration.displayName}</h2>
          </div>
          <p className="text-[#707070] text-sm leading-relaxed">
            {integrationDescription(integration.name)}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em]",
            statusClassName(integration.status),
          )}
        >
          {STATUS_LABELS[integration.status]}
        </span>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {isActive ? (
          <button
            className="inline-flex h-10 flex-1 items-center justify-center rounded-full px-4 text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={isBusy || isOtherDisconnecting}
            onClick={onDisconnect}
            type="button"
          >
            {isDisconnecting ? (
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
            )}
            Disconnect
          </button>
        ) : (
          <button
            className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-[#1b1b1b] px-4 font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-45"
            disabled={isBusy}
            onClick={onConnect}
            type="button"
          >
            {isConnecting ? (
              <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink aria-hidden="true" className="mr-2 h-4 w-4" />
            )}
            Connect
          </button>
        )}
      </div>
      {integration.updatedAt ? (
        <p className="mt-4 text-[#8a8a8a] text-[12px]">
          Updated {formatDate(integration.updatedAt)}
        </p>
      ) : null}
    </section>
  );
}

function IntegrationsLoading() {
  return (
    <>
      {LOADING_INTEGRATION_NAMES.map((name) => (
        <section
          className="min-h-44 animate-pulse rounded-[22px] border border-[#f1f1f1] bg-white p-6"
          key={name}
        >
          <div className="h-5 w-28 rounded bg-[#ededed]" />
          <div className="mt-4 h-3 w-full rounded bg-[#f1f1f1]" />
          <div className="mt-2 h-3 w-2/3 rounded bg-[#f1f1f1]" />
          <div className="mt-8 h-10 rounded-full bg-[#f1f1f1]" />
        </section>
      ))}
    </>
  );
}

function IntegrationMark({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full ring-4",
        isActive
          ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/5"
          : "bg-yellow-500/10 text-yellow-400 ring-yellow-500/5",
      )}
    >
      {isActive ? (
        <Check aria-hidden="true" className="h-4 w-4" />
      ) : (
        <Zap aria-hidden="true" className="h-4 w-4" />
      )}
    </span>
  );
}

function integrationDescription(name: IntegrationName): string {
  switch (name) {
    case "github":
      return "Read repositories, create branches, and prepare code changes when the user asks.";
    case "gmail":
      return "Send requested email drafts through the user's connected Gmail account.";
    case "slack":
      return "Post requested messages or retrieve workspace context through connected Slack.";
    case "notion":
      return "Create pages and read workspace content for requested document workflows.";
    case "linear":
      return "Read and create issues for project planning and implementation tasks.";
    default:
      return "Let your agents take actions in this connected app when you ask.";
  }
}

function statusClassName(status: Integration["status"]): string {
  switch (status) {
    case "active":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
    case "initiating":
      return "border-yellow-500/20 bg-yellow-500/10 text-yellow-300";
    case "expired":
    case "failed":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    case "inactive":
    case "not_connected":
      return "border-[#f1f1f1] bg-[#f7f7f7] text-[#707070]";
  }
}

function useIntegrationsQuery(getToken: () => Promise<null | string>) {
  return useQuery({
    queryFn: () => listIntegrations(getToken),
    queryKey: INTEGRATIONS_QUERY,
    staleTime: 30_000,
  });
}

function useConnectIntegration(getToken: () => Promise<null | string>) {
  return useMutation({
    mutationFn: (integration: IntegrationName) => connectIntegration(getToken, integration),
    onError: (error) => toast.error(error.message),
    onSuccess: (oauthUrl) => {
      window.location.assign(oauthUrl);
    },
  });
}

function useDisconnectIntegration(
  getToken: () => Promise<null | string>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return useMutation({
    mutationFn: (integration: IntegrationName) => disconnectIntegration(getToken, integration),
    onError: (error) => toast.error(error.message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY });
      toast.success("Integration disconnected");
    },
  });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
