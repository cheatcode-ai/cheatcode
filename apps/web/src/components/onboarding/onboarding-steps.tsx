"use client";

import type { PaidBillingTier } from "@cheatcode/types";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Check, ExternalLink, Loader2 } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

const INTRO_BULLETS = [
  "A full computer - a sandboxed Linux box for code, shells, and files.",
  "A full browser - I navigate, click, and hand control back when you want it.",
  "Skills & integrations - connect your tools and reusable skills.",
  "Your models, your keys - bring your own provider keys; nothing is marked up.",
  "Live phone previews - watch mobile apps update as I build them.",
] as const;

const TOOL_ROWS = [
  { description: "Create repos, open pull requests, and read your code.", name: "GitHub" },
  { description: "Read and update pages and databases.", name: "Notion" },
  { description: "Post messages and read the channels you choose.", name: "Slack" },
] as const;

const BASIC_ROWS = [
  {
    cta: "Open automations",
    description: 'Automate routine work - e.g. "Every morning at 8, draft a social pack."',
    href: "/automations",
    title: "Automations",
  },
  {
    cta: "Browse skills",
    description: 'Teach reusable skills - e.g. "Create an invoice-chaser skill."',
    href: "/skills",
    title: "Custom skills",
  },
  {
    cta: null,
    description: "This is the computer I use - a persistent sandbox per project for real work.",
    href: null,
    title: "Your agent computer",
  },
] as const;

// Sandbox-hour allowances mirror PLAN_CATALOG in @cheatcode/billing (design 15f).
const TIERS = [
  { bullet: "60 sandbox-hours / month", name: "Pro", price: "$25", tier: "pro" },
  { bullet: "140 sandbox-hours / month", name: "Premium", price: "$50", tier: "premium" },
  { bullet: "320 sandbox-hours / month", name: "Ultra", price: "$99", tier: "ultra" },
  { bullet: "800 sandbox-hours / month", name: "Max", price: "$200", tier: "max" },
] as const satisfies readonly {
  bullet: string;
  name: string;
  price: string;
  tier: PaidBillingTier;
}[];

export function IntroStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="space-y-6">
      <StepHeader subtitle="I'm your agent team. I have:" title="Welcome to Cheatcode" />
      <ul className="space-y-3">
        {INTRO_BULLETS.map((bullet) => (
          <li className="flex gap-3 text-[#707070] text-sm" key={bullet}>
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#5b9a73]" />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      <StepFooter>
        <ContinueButton onClick={onContinue} />
      </StepFooter>
    </div>
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
  return (
    <div className="space-y-6">
      <StepHeader progress="1 / 4" title="First, give your agents a name" />
      <input
        className="h-12 w-full rounded-[18px] border border-[#f1f1f1] bg-[#fafafa] px-4 text-[#1b1b1b] text-sm outline-none placeholder:text-[#b5b5b5] focus:border-[#dedede] focus:bg-white"
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        placeholder="Give your agent a name"
        value={name}
      />
      <StepFooter>
        <SkipButton onClick={onSkip} />
        <ContinueButton onClick={() => onContinue(name.trim())} />
      </StepFooter>
    </div>
  );
}

export function ToolsStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  return (
    <div className="space-y-6">
      <StepHeader progress="2 / 4" title="Second, give me access to your tools" />
      <div className="space-y-3">
        {TOOL_ROWS.map((tool) => (
          <div
            className="flex items-center justify-between gap-4 rounded-[18px] border border-[#f1f1f1] bg-[#fafafa] px-4 py-3"
            key={tool.name}
          >
            <div className="min-w-0">
              <div className="font-medium text-[#1b1b1b] text-sm">{tool.name}</div>
              <p className="mt-0.5 text-[#8a8a8a] text-xs">{tool.description}</p>
            </div>
            <Link
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#f1f1f1] bg-white px-3 py-2 text-[#4f4f4f] text-xs transition-colors hover:border-[#dedede] hover:text-[#1b1b1b]"
              href="/tools"
            >
              Connect
              <ExternalLink aria-hidden="true" className="h-3 w-3" />
            </Link>
          </div>
        ))}
      </div>
      <StepFooter>
        <SkipButton onClick={onSkip} />
        <ContinueButton onClick={onContinue}>Next</ContinueButton>
      </StepFooter>
    </div>
  );
}

export function BasicsStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  return (
    <div className="space-y-6">
      <StepHeader progress="3 / 4" title="3 basic things" />
      <div className="space-y-3">
        {BASIC_ROWS.map((row) => (
          <div
            className="rounded-[18px] border border-[#f1f1f1] bg-[#fafafa] px-4 py-3"
            key={row.title}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-[#1b1b1b] text-sm">{row.title}</div>
              {row.cta ? <BasicCta cta={row.cta} href={row.href} /> : null}
            </div>
            <p className="mt-1 text-[#8a8a8a] text-xs leading-relaxed">{row.description}</p>
          </div>
        ))}
      </div>
      <StepFooter>
        <SkipButton onClick={onSkip} />
        <ContinueButton onClick={onContinue} />
      </StepFooter>
    </div>
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
    <div className="space-y-6">
      <StepHeader progress="4 / 4" title="Last thing, add sandbox time to start building" />
      <div className="grid gap-3 sm:grid-cols-2">
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
      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
        <SkipButton onClick={() => onComplete("/settings/api-keys")}>
          Not ready for a plan? Bring your own keys
        </SkipButton>
        <SkipButton onClick={() => onComplete("/")}>Start from home</SkipButton>
      </div>
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
    <div className="flex flex-col justify-between rounded-[18px] border border-[#f1f1f1] bg-[#fafafa] p-5">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="font-medium text-[#1b1b1b]">{tier.name}</span>
          <span className="font-mono text-[#4f4f4f] text-sm">{tier.price}/mo</span>
        </div>
        <p className="mt-2 text-[#8a8a8a] text-xs">{tier.bullet}</p>
      </div>
      {available ? (
        <button
          className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-[#1b1b1b] px-4 font-medium text-sm text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isBusy}
          onClick={() => onCheckout(tier.tier)}
          type="button"
        >
          {isBusy ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : null}
          Upgrade to {tier.name}
        </button>
      ) : (
        <div className="mt-4 flex h-10 items-center justify-center rounded-full border border-[#f1f1f1] text-[#a0a0a0] text-xs">
          Coming soon
        </div>
      )}
    </div>
  );
}

function BasicCta({ cta, href }: { cta: string; href: string | null }) {
  if (!href) {
    return <span className="text-[#a0a0a0] text-xs">{cta}</span>;
  }
  return (
    <Link className="text-[#1b1b1b] text-xs underline-offset-2 hover:underline" href={href}>
      {cta}
    </Link>
  );
}

function StepHeader({
  progress,
  subtitle,
  title,
}: {
  progress?: string;
  subtitle?: string;
  title: string;
}) {
  return (
    <header className="space-y-2">
      {progress ? (
        <p className="font-mono text-[#a0a0a0] text-[10px] uppercase tracking-[0.24em]">
          {progress}
        </p>
      ) : null}
      <h1 className="font-bold text-[#1b1b1b] text-[24px] leading-[32px] tracking-normal">
        {title}
      </h1>
      {subtitle ? <p className="text-[#707070] text-sm leading-relaxed">{subtitle}</p> : null}
    </header>
  );
}

function StepFooter({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 pt-2">{children}</div>;
}

function ContinueButton({ children, onClick }: { children?: ReactNode; onClick: () => void }) {
  return (
    <button
      className={cn(
        "inline-flex h-11 items-center justify-center rounded-full bg-[#1b1b1b] px-6",
        "font-medium text-white transition-colors hover:bg-black",
      )}
      onClick={onClick}
      type="button"
    >
      {children ?? "Continue"}
    </button>
  );
}

function SkipButton({ children, onClick }: { children?: ReactNode; onClick: () => void }) {
  return (
    <button
      className="inline-flex h-11 items-center justify-center rounded-full px-4 text-[#707070] text-sm transition-colors hover:bg-[#fafafa] hover:text-[#1b1b1b]"
      onClick={onClick}
      type="button"
    >
      {children ?? "Skip"}
    </button>
  );
}
