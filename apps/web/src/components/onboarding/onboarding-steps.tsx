"use client";

import type { IntegrationName, PaidBillingTier } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  GitHubLogo,
  IconBrowser,
  IconComputer,
  IconKeys,
  IconPhone,
  IconSkills,
  NotionLogo,
  ReturnArrow,
  SearchIcon,
  SlackLogo,
  Sparkle,
} from "@/components/onboarding/onboarding-icons";
import { Check } from "@/components/ui/icons";
import { connectIntegration, INTEGRATIONS_QUERY, listIntegrations } from "@/lib/api/integrations";
import { cn } from "@/lib/ui/cn";

// The 15-series "Bud System" onboarding: a card-less, viewport-centered flow where the agent
// introduces itself. Every measurement (Geist 14px, #1B1B1B ink, 32px pills, 14px-radius cards)
// is lifted verbatim from the Paper artboards 15b–15f so this renders pixel-identical.

type FeatureRow = { icon: ReactNode; key: string; lead?: string; strong: string; trail?: string };

const FEATURE_ROWS: readonly FeatureRow[] = [
  { icon: <IconComputer />, key: "computer", lead: "a full", strong: "computer" },
  { icon: <IconBrowser />, key: "browser", lead: "a full", strong: "browser" },
  { icon: <IconSkills />, key: "skills", strong: "skills", trail: "& integrations" },
  { icon: <IconKeys />, key: "keys", lead: "your models,", strong: "your keys" },
  { icon: <IconPhone />, key: "phone", lead: "live", strong: "phone previews" },
];

const TOOL_ROWS = [
  {
    description: "Inspect repositories, issues, pull requests, commits, and code.",
    logo: <GitHubLogo />,
    name: "GitHub",
    slug: "github",
  },
  {
    description: "Search pages, update content, query databases, and manage comments.",
    logo: <NotionLogo />,
    name: "Notion",
    slug: "notion",
  },
  {
    description: "Search conversations, manage channels, messages, and files.",
    logo: <SlackLogo />,
    name: "Slack",
    slug: "slack",
  },
] as const satisfies readonly {
  description: string;
  logo: ReactNode;
  name: string;
  slug: IntegrationName;
}[];

const TIERS = [
  { bullet: "60 sandbox hours / month", name: "Pro", price: "$25/mo", tier: "pro" },
  { bullet: "140 sandbox hours / month", name: "Premium", price: "$50/mo", tier: "premium" },
  { bullet: "320 sandbox hours / month", name: "Ultra", price: "$99/mo", tier: "ultra" },
  { bullet: "800 sandbox hours / month", name: "Max", price: "$200/mo", tier: "max" },
] as const satisfies readonly {
  bullet: string;
  name: string;
  price: string;
  tier: PaidBillingTier;
}[];

export function IntroStep({ onContinue }: { onContinue: () => void }) {
  return (
    <Shell width={360}>
      <Sparkle />
      <div className="flex justify-center pt-11 pb-1.5 text-[#1B1B1B] text-[14px] leading-[18px]">
        <span className="font-medium">I'm your&nbsp;</span>
        <span className="font-bold">agent team</span>
        <span className="font-medium">. I have:</span>
      </div>
      {FEATURE_ROWS.map((row) => (
        <div
          className="flex w-[200px] shrink-0 items-center gap-[9px] whitespace-nowrap pt-3 text-[#1B1B1B] text-[14px] leading-[18px]"
          key={row.key}
        >
          <span className="mr-[9px] flex shrink-0">{row.icon}</span>
          {row.lead ? <span className="font-medium">{row.lead}</span> : null}
          <span className="font-semibold underline decoration-1 underline-offset-2">
            {row.strong}
          </span>
          {row.trail ? <span className="font-medium">{row.trail}</span> : null}
        </div>
      ))}
      <Actions className="pt-11">
        <PrimaryPill onClick={onContinue}>Continue</PrimaryPill>
      </Actions>
    </Shell>
  );
}

export function NameStep({
  initialName,
  onContinue,
  onSkip,
}: {
  initialName: string;
  onContinue: (name: string) => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState(initialName);
  const empty = name.trim().length === 0;
  return (
    <Shell width={360}>
      <Sparkle />
      <Eyebrow>1/4</Eyebrow>
      <StepTitle>First, give your agents a name</StepTitle>
      <input
        aria-label="Agent name"
        className="mt-[22px] h-[34px] w-[204px] rounded-full bg-[#F7F7F7] px-4 text-center font-medium text-[#1B1B1B] text-[14px] leading-[18px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] outline-none placeholder:text-[#B5B5B5] focus:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !empty) {
            onContinue(name.trim());
          }
        }}
        placeholder="Name your agent"
        value={name}
      />
      <Actions className="pt-11">
        <SkipPill onClick={onSkip} />
        <PrimaryPill disabled={empty} onClick={() => onContinue(name.trim())}>
          Continue
        </PrimaryPill>
      </Actions>
    </Shell>
  );
}

export function ToolsStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const integrationsQuery = useQuery({
    queryFn: () => listIntegrations(getToken),
    queryKey: INTEGRATIONS_QUERY,
    staleTime: 30_000,
  });
  const connected = new Set(
    (integrationsQuery.data ?? []).filter((row) => row.status === "active").map((row) => row.name),
  );
  const connect = useMutation({
    mutationFn: (slug: IntegrationName) => connectIntegration(getToken, slug),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not start that connection."),
    onSuccess: (oauthUrl) => {
      // Open OAuth consent in a new tab so first-run onboarding stays put; connected state
      // refreshes when the user returns and the query refetches.
      window.open(oauthUrl, "_blank", "noopener,noreferrer");
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY });
    },
  });
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? TOOL_ROWS.filter(
        (tool) =>
          tool.name.toLowerCase().includes(needle) ||
          tool.description.toLowerCase().includes(needle),
      )
    : TOOL_ROWS;
  return (
    <Shell width={440}>
      <Sparkle />
      <Eyebrow>2/4</Eyebrow>
      <StepTitle>Second, give me access to your tools.</StepTitle>
      <div className="mt-[22px] flex h-8 w-full items-center gap-2 rounded-full bg-white px-3 shadow-[0_0_1px_0_rgba(0,0,0,0.12),0_1px_2px_0_rgba(0,0,0,0.04)] focus-within:shadow-[0_0_0_1px_rgba(0,0,0,0.12)]">
        <SearchIcon />
        <input
          aria-label="Search skills"
          className="w-full bg-transparent font-medium text-[#1B1B1B] text-[14px] leading-[18px] outline-none placeholder:text-[#9B9B9B]"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search skills"
          value={query}
        />
      </div>
      <div className="flex w-full flex-col gap-2 pt-2.5">
        {rows.map((tool) => (
          <ToolCard
            connected={connected.has(tool.slug)}
            key={tool.name}
            onConnect={() => connect.mutate(tool.slug)}
            pending={connect.isPending && connect.variables === tool.slug}
            tool={tool}
          />
        ))}
        {rows.length === 0 ? (
          <p className="py-3 text-center font-medium text-[#585858] text-[13px] leading-4">
            No skills match "{query}".
          </p>
        ) : null}
      </div>
      <Actions className="pt-9">
        <SkipPill onClick={onSkip} />
        <PrimaryPill onClick={onContinue}>Next</PrimaryPill>
      </Actions>
    </Shell>
  );
}

export function BasicsStep({
  onComplete,
  onContinue,
  onSkip,
}: {
  onComplete: (target: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <Shell width={440}>
      <Sparkle />
      <Eyebrow>3/4</Eyebrow>
      <StepTitle>Third, these are the 3 basic things you need to know about me:</StepTitle>
      <NumberedLine className="pt-[22px]">1. I can run autonomously:</NumberedLine>
      <BasicCard>
        <span className="font-medium text-[#1B1B1B] text-[14px] leading-[18px]">
          Every morning at 8, draft a social pack
        </span>
        <span className="flex-1" />
        <PreviewPill onClick={() => onComplete("/automations")}>Create</PreviewPill>
      </BasicCard>
      <NumberedLine className="pt-[18px]">2. You can teach me custom skills:</NumberedLine>
      <BasicCard>
        <div className="flex flex-col gap-px">
          <span className="font-medium text-[#1B1B1B] text-[14px] leading-[18px]">
            Create invoice-chaser skill
          </span>
          <span className="font-medium text-[#585858] text-[12px] leading-4">
            Chase overdue invoices end-to-end — list, filter, draft follow-ups…
          </span>
        </div>
        <span className="flex-1" />
        <PreviewPill onClick={() => onComplete("/skills")}>Create</PreviewPill>
      </BasicCard>
      <NumberedLine className="pt-[18px]">
        3. And this is the{" "}
        <span className="font-semibold underline decoration-1 underline-offset-2">computer</span> I
        use to code, store files, and browse.
      </NumberedLine>
      <Actions className="pt-9">
        <SkipPill onClick={onSkip} />
        <PrimaryPill onClick={onContinue}>Continue</PrimaryPill>
      </Actions>
    </Shell>
  );
}

export function PlanStep({
  availableTiers,
  isBusy,
  onCheckout,
  onComplete,
}: {
  availableTiers: ReadonlySet<PaidBillingTier>;
  isBusy: boolean;
  onCheckout: (tier: PaidBillingTier) => void;
  onComplete: (target: string) => void;
}) {
  return (
    <Shell width={360}>
      <Sparkle />
      <Eyebrow>4/4</Eyebrow>
      <StepTitle>Last thing, add sandbox time to start building.</StepTitle>
      <div className="flex w-full flex-col gap-2 pt-[22px]">
        {TIERS.map((tier) => (
          <PlanCard
            available={availableTiers.has(tier.tier)}
            isBusy={isBusy}
            key={tier.name}
            onCheckout={onCheckout}
            tier={tier}
          />
        ))}
      </div>
      <button
        className="mt-5 flex h-[30px] items-center rounded-full bg-[#F4F4F4] px-3.5 font-medium text-[#1B1B1B] text-[13px] leading-4 transition-colors hover:bg-[#ececec]"
        onClick={() => onComplete("/settings/api-keys")}
        type="button"
      >
        Not ready for a plan? Bring your own keys
      </button>
      <button
        className="pt-3.5 font-medium text-[#1B1B1B] text-[14px] leading-[18px] hover:underline"
        onClick={() => onComplete("/")}
        type="button"
      >
        See the dashboard first
      </button>
    </Shell>
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
    <div className="flex items-center gap-3 rounded-[14px] border border-[#f0f0f0] bg-white px-3.5 py-3 shadow-[0_1px_2px_0_rgba(0,0,0,0.04)] transition-all hover:border-[#e4e4e4] hover:shadow-[0_2px_10px_0_rgba(0,0,0,0.06)]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#f0f0f0] bg-[#fbfbfb]">
        {tool.logo}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[#1B1B1B] text-[14px] leading-[18px]">{tool.name}</div>
        <p className="mt-0.5 truncate font-medium text-[#8a8a8a] text-[12px] leading-4">
          {tool.description}
        </p>
      </div>
      {connected ? (
        <span className="flex shrink-0 items-center gap-1 font-medium text-[#5b9a73] text-[13px] leading-[18px]">
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
          Connected
        </span>
      ) : (
        <button
          className="flex h-8 shrink-0 items-center rounded-full border border-[#e6e6e6] bg-white px-3.5 font-medium text-[#1B1B1B] text-[13px] leading-[18px] transition-colors hover:border-[#d4d4d4] hover:bg-[#fafafa] disabled:opacity-60"
          disabled={pending}
          onClick={onConnect}
          type="button"
        >
          {pending ? "Connecting…" : "Connect"}
        </button>
      )}
    </div>
  );
}

function PlanCard({
  available,
  isBusy,
  onCheckout,
  tier,
}: {
  available: boolean;
  isBusy: boolean;
  onCheckout: (tier: PaidBillingTier) => void;
  tier: { bullet: string; name: string; price: string; tier: PaidBillingTier };
}) {
  return (
    <div className="flex items-center rounded-[14px] bg-[#FAFAF9] py-2 pr-1.5 pl-3.5 shadow-[0_0_1px_0_rgba(0,0,0,0.12),0_1px_2px_0_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-px">
        <div className="flex items-baseline gap-1.5">
          <span className="font-semibold text-[#1B1B1B] text-[14px] leading-[18px]">
            {tier.name}
          </span>
          <span className="font-bold text-[#1B1B1B] text-[14px] leading-[18px]">{tier.price}</span>
        </div>
        <span className="font-medium text-[#585858] text-[12px] leading-4">{tier.bullet}</span>
      </div>
      <span className="flex-1" />
      <button
        className="flex h-8 items-center rounded-full bg-[#1B1B1B] px-3.5 font-medium text-[14px] text-white leading-[18px] transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isBusy || !available}
        onClick={() => onCheckout(tier.tier)}
        type="button"
      >
        Get {tier.name}
      </button>
    </div>
  );
}

function Shell({ children, width }: { children: ReactNode; width: 360 | 440 }) {
  return (
    <div
      className="flex w-full flex-col items-center"
      style={{ maxWidth: width, fontSynthesis: "none" }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="pt-[26px] font-medium text-[#585858] text-[13px] leading-4">{children}</p>;
}

function StepTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="pt-2.5 text-center font-medium text-[#1B1B1B] text-[14px] leading-[18px]">
      {children}
    </h1>
  );
}

function NumberedLine({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("w-full font-medium text-[#1B1B1B] text-[14px] leading-[18px]", className)}>
      {children}
    </p>
  );
}

function BasicCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2.5 flex w-full items-center rounded-[14px] bg-[#FAFAF9] py-[9px] pr-1.5 pl-3.5 shadow-[0_0_1px_0_rgba(0,0,0,0.12),0_1px_2px_0_rgba(0,0,0,0.04)]">
      {children}
    </div>
  );
}

// The Basics "Create" pill jumps straight to building that thing — it finishes onboarding and
// routes to Automations / Skills so the example is a real shortcut, not a dead preview.
function PreviewPill({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="flex h-8 shrink-0 items-center rounded-full bg-[#1B1B1B] px-3.5 font-medium text-[14px] text-white leading-[18px] transition-colors hover:bg-black"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Actions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-2.5", className)}>{children}</div>;
}

function PrimaryPill({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex h-8 items-center gap-2 rounded-full px-3.5 font-medium text-[14px] leading-[18px] transition-colors",
        disabled
          ? "cursor-not-allowed bg-[#ABABA8] text-white/90"
          : "bg-[#1B1B1B] text-white hover:bg-black",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
      <ReturnArrow />
    </button>
  );
}

function SkipPill({ children, onClick }: { children?: ReactNode; onClick: () => void }) {
  return (
    <button
      className="flex h-8 items-center rounded-full bg-white px-3.5 font-medium text-[#1B1B1B] text-[14px] leading-[18px] shadow-[inset_0_0_2px_0_rgba(0,0,0,0.02),0_0_1px_0_rgba(0,0,0,0.08)] transition-colors hover:bg-[#fafafa]"
      onClick={onClick}
      type="button"
    >
      {children ?? "Skip"}
    </button>
  );
}
