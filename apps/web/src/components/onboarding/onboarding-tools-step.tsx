"use client";

import type { IntegrationName } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  GitHubLogo,
  NotionLogo,
  SearchIcon,
  SlackLogo,
  Sparkle,
} from "@/components/onboarding/onboarding-icons";
import { Check } from "@/components/ui/icons";
import { connectIntegration, INTEGRATIONS_QUERY, listIntegrations } from "@/lib/api/integrations";
import {
  OnboardingActions,
  OnboardingEyebrow,
  OnboardingPrimaryPill,
  OnboardingSkipPill,
  OnboardingStepShell,
  OnboardingStepTitle,
} from "./onboarding-step-primitives";

const TOOL_ROWS = [
  tool(
    "GitHub",
    "github",
    "Inspect repositories, issues, pull requests, commits, and code.",
    <GitHubLogo />,
  ),
  tool(
    "Notion",
    "notion",
    "Search pages, update content, query databases, and manage comments.",
    <NotionLogo />,
  ),
  tool(
    "Slack",
    "slack",
    "Search conversations, manage channels, messages, and files.",
    <SlackLogo />,
  ),
] as const;

export function ToolsStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  const tools = useOnboardingTools();
  return (
    <OnboardingStepShell width={440}>
      <Sparkle />
      <OnboardingEyebrow>2/4</OnboardingEyebrow>
      <OnboardingStepTitle>Second, give me access to your tools.</OnboardingStepTitle>
      <ToolsSearch query={tools.query} setQuery={tools.setQuery} />
      <div className="flex w-full flex-col gap-2 pt-2.5">
        {tools.rows.map((toolRow) => (
          <ToolCard
            connected={tools.connected.has(toolRow.slug)}
            key={toolRow.name}
            onConnect={() => tools.connect.mutate(toolRow.slug)}
            pending={tools.connect.isPending && tools.connect.variables === toolRow.slug}
            tool={toolRow}
          />
        ))}
        {tools.rows.length === 0 ? <NoMatchingTools query={tools.query} /> : null}
      </div>
      <OnboardingActions className="pt-9">
        <OnboardingSkipPill onClick={onSkip} />
        <OnboardingPrimaryPill onClick={onContinue}>Next</OnboardingPrimaryPill>
      </OnboardingActions>
    </OnboardingStepShell>
  );
}

function useOnboardingTools() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const integrationsQuery = useQuery({
    queryFn: () => listIntegrations(getToken),
    queryKey: INTEGRATIONS_QUERY,
    staleTime: 30_000,
  });
  const connect = useMutation({
    mutationFn: (slug: IntegrationName) => connectIntegration(getToken, slug),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not start that connection."),
    onSuccess: (oauthUrl) => {
      window.open(oauthUrl, "_blank", "noopener,noreferrer");
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY });
    },
  });
  const connected = new Set<IntegrationName>();
  for (const row of integrationsQuery.data ?? []) {
    if (row.status === "active") {
      connected.add(row.name);
    }
  }
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? TOOL_ROWS.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle),
      )
    : TOOL_ROWS;
  return { connect, connected, query, rows, setQuery };
}

function ToolsSearch({ query, setQuery }: { query: string; setQuery: (query: string) => void }) {
  return (
    <div className="mt-[22px] flex h-8 w-full items-center gap-2 rounded-full bg-background px-3 shadow-[0_0_1px_0_rgba(0,0,0,0.12),0_1px_2px_0_rgba(0,0,0,0.04)] focus-within:shadow-[0_0_0_1px_rgba(0,0,0,0.12)]">
      <SearchIcon />
      <input
        aria-label="Search skills"
        className="w-full bg-transparent font-medium text-[14px] text-foreground leading-[18px] outline-none placeholder:text-placeholder"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search skills"
        value={query}
      />
    </div>
  );
}

function ToolCard({
  connected,
  onConnect,
  pending,
  tool,
}: {
  connected: boolean;
  onConnect: () => void;
  pending: boolean;
  tool: (typeof TOOL_ROWS)[number];
}) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-border bg-background px-3.5 py-3 shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] transition-all hover:border-border hover:shadow-[0_2px_10px_0_rgba(0,0,0,0.06)]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-bg-secondary">
        {tool.logo}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[14px] text-foreground leading-[18px]">{tool.name}</div>
        <p className="mt-0.5 truncate font-medium text-[12px] text-placeholder leading-4">
          {tool.description}
        </p>
      </div>
      <ToolConnectionAction connected={connected} onConnect={onConnect} pending={pending} />
    </div>
  );
}

function ToolConnectionAction({
  connected,
  onConnect,
  pending,
}: {
  connected: boolean;
  onConnect: () => void;
  pending: boolean;
}) {
  return connected ? (
    <span className="flex shrink-0 items-center gap-1 font-medium text-[13px] text-success-fg leading-[18px]">
      <Check aria-hidden="true" className="h-3.5 w-3.5" />
      Connected
    </span>
  ) : (
    <button
      className="flex h-8 shrink-0 items-center rounded-full border border-border bg-background px-3.5 font-medium text-[13px] text-foreground leading-[18px] transition-colors hover:border-border hover:bg-bg-secondary disabled:opacity-60"
      disabled={pending}
      onClick={onConnect}
      type="button"
    >
      {pending ? "Connecting…" : "Connect"}
    </button>
  );
}

function NoMatchingTools({ query }: { query: string }) {
  return (
    <p className="py-3 text-center font-medium text-[13px] text-fg-secondary leading-4">
      No skills match "{query}".
    </p>
  );
}

function tool(name: string, slug: IntegrationName, description: string, logo: ReactNode) {
  return { description, logo, name, slug };
}
