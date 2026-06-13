"use client";

import {
  type Integration,
  IntegrationConnectResponseSchema,
  type IntegrationName,
  IntegrationSchema,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, Trash2, Zap } from "@/components/ui/icons";
import { authorizedFetch } from "@/lib/api/authorized-fetch";
import { cn } from "@/lib/ui/cn";

const INTEGRATIONS_QUERY = ["integrations"] as const;

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
    <div className="flex flex-col items-center text-zinc-200">
      <div className="mb-10 max-w-xl space-y-6 text-center">
        <h1 className="font-medium text-2xl text-white tracking-tight">Integrations</h1>
        <p className="text-sm text-zinc-500 leading-relaxed">
          Connect OAuth tools for agent actions. Connections are routed through Composio and
          executed server-side by V2 workers.
        </p>
      </div>
      <div className="grid w-full max-w-4xl gap-4 md:grid-cols-2">
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
    <section className="rounded-3xl border border-zinc-800/80 bg-[#111] p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <IntegrationMark isActive={isActive} />
            <h2 className="font-medium text-white">{integration.displayName}</h2>
          </div>
          <p className="text-sm text-zinc-500 leading-relaxed">
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
            className="inline-flex h-10 flex-1 items-center justify-center rounded-xl px-4 text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-45"
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
            className="inline-flex h-10 flex-1 items-center justify-center rounded-xl bg-white px-4 font-medium text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-45"
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
        <p className="mt-4 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.2em]">
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
          className="min-h-44 animate-pulse rounded-3xl border border-zinc-800/80 bg-[#111] p-6 shadow-xl"
          key={name}
        >
          <div className="h-5 w-28 rounded bg-zinc-800" />
          <div className="mt-4 h-3 w-full rounded bg-zinc-900" />
          <div className="mt-2 h-3 w-2/3 rounded bg-zinc-900" />
          <div className="mt-8 h-10 rounded-xl bg-zinc-900" />
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
      return "border-zinc-800 bg-black/30 text-zinc-500";
  }
}

function useIntegrationsQuery(getToken: () => Promise<null | string>) {
  return useQuery({
    queryFn: async () => {
      const response = await authorizedFetch(getToken, "/v1/integrations");
      return IntegrationSchema.array().parse(await response.json());
    },
    queryKey: INTEGRATIONS_QUERY,
    staleTime: 30_000,
  });
}

function useConnectIntegration(getToken: () => Promise<null | string>) {
  return useMutation({
    mutationFn: async (integration: IntegrationName) => {
      const response = await authorizedFetch(getToken, `/v1/integrations/${integration}/connect`, {
        method: "POST",
      });
      return IntegrationConnectResponseSchema.parse(await response.json());
    },
    onError: (error) => toast.error(error.message),
    onSuccess: ({ oauthUrl }) => {
      window.location.assign(oauthUrl);
    },
  });
}

function useDisconnectIntegration(
  getToken: () => Promise<null | string>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return useMutation({
    mutationFn: async (integration: IntegrationName) => {
      await authorizedFetch(getToken, `/v1/integrations/${integration}`, { method: "DELETE" });
    },
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
