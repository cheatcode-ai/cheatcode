"use client";

import type { PaidBillingTier } from "@cheatcode/types";
import { type ReactNode, useState } from "react";
import {
  GitHubMark,
  IconBrowser,
  IconComputer,
  IconKeys,
  IconPhone,
  IconSkills,
  ReturnArrow,
  SearchIcon,
  Sparkle,
} from "@/components/onboarding/onboarding-icons";
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
    badge: <GitHubMark />,
    description: "Inspect repositories, issues, pull requests, commits, and code.",
    name: "GitHub",
  },
  {
    badge: <LetterBadge color="#1B1B1B" letter="N" />,
    description: "Search pages, update content, query databases, and manage comments.",
    name: "Notion",
  },
  {
    badge: <LetterBadge color="#4A154B" letter="S" />,
    description: "Search conversations, manage channels, messages, and files.",
    name: "Slack",
  },
] as const;

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
  return (
    <Shell width={440}>
      <Sparkle />
      <Eyebrow>2/4</Eyebrow>
      <StepTitle>Second, give me access to your tools.</StepTitle>
      <div className="mt-[22px] flex h-8 w-full items-center gap-2 rounded-full bg-white px-3 shadow-[0_0_1px_0_rgba(0,0,0,0.12),0_1px_2px_0_rgba(0,0,0,0.04)]">
        <SearchIcon />
        <span className="font-medium text-[#9B9B9B] text-[14px] leading-[18px]">Search skills</span>
      </div>
      <div className="flex w-full flex-col gap-2 pt-2.5">
        {TOOL_ROWS.map((tool) => (
          <ToolCard key={tool.name} tool={tool} />
        ))}
      </div>
      <Actions className="pt-9">
        <SkipPill onClick={onSkip} />
        <PrimaryPill onClick={onContinue}>Next</PrimaryPill>
      </Actions>
    </Shell>
  );
}

export function BasicsStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
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
        <PreviewPill>Create</PreviewPill>
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
        <PreviewPill>Create</PreviewPill>
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

function ToolCard({ tool }: { tool: (typeof TOOL_ROWS)[number] }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-white px-3.5 py-2.5 shadow-[0_0_1px_0_rgba(0,0,0,0.12),0_1px_2px_0_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <span className="flex shrink-0">{tool.badge}</span>
        <span className="font-medium text-[#1B1B1B] text-[14px] leading-[18px]">{tool.name}</span>
      </div>
      <p className="font-medium text-[#585858] text-[13px] leading-4">{tool.description}</p>
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

function LetterBadge({ color, letter }: { color: string; letter: string }) {
  return (
    <span
      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] font-semibold text-[9px] text-white leading-3"
      style={{ backgroundColor: color }}
    >
      {letter}
    </span>
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

// Illustrative preview action on the Basics screen — the design shows a "Create" pill next to each
// example, but it is a preview of capability, not a live action during first-run.
function PreviewPill({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 shrink-0 items-center rounded-full bg-[#1B1B1B] px-3.5 font-medium text-[14px] text-white leading-[18px]">
      {children}
    </span>
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
