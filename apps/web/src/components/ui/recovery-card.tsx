import type { LucideIcon } from "@cheatcode/ui";
import { Loader2, RefreshCw } from "@cheatcode/ui";
import Link from "next/link";
import { cn } from "@/lib/ui/cn";

type RecoveryActionBase = {
  icon?: LucideIcon | undefined;
  label: string;
};

type RecoveryButtonAction = RecoveryActionBase & {
  href?: never;
  isPending?: boolean | undefined;
  onClick: () => void;
  pendingLabel?: string | undefined;
};

type RecoveryLinkAction = RecoveryActionBase & {
  href: string;
  isPending?: never;
  onClick?: never;
  pendingLabel?: never;
};

type RecoveryAction = RecoveryButtonAction | RecoveryLinkAction;

type RecoveryCardProps = {
  action?: RecoveryAction | undefined;
  announce?: "assertive" | "off" | "polite" | undefined;
  className?: string | undefined;
  description: string;
  detail?: string | undefined;
  headingLevel?: 1 | 2 | 3 | undefined;
  icon: LucideIcon;
  size?: "compact" | "default" | undefined;
  title: string;
  variant?: "inline" | "stacked" | undefined;
};

type RecoveryContentProps = Pick<
  RecoveryCardProps,
  "action" | "description" | "detail" | "size" | "title"
> & {
  headingTag: "h1" | "h2" | "h3";
  icon: LucideIcon;
};

/** Recovery surface for blocking failures and compact section-level failures. */
export function RecoveryCard({
  action,
  announce = "polite",
  className,
  description,
  detail,
  headingLevel = 2,
  icon: Icon,
  size = "default",
  title,
  variant = "stacked",
}: RecoveryCardProps) {
  const headingTag = headingLevel === 1 ? "h1" : headingLevel === 3 ? "h3" : "h2";
  const liveProps = recoveryLiveProps(announce);
  return (
    <div
      className={cn(
        variant === "inline"
          ? "w-full rounded-[18px] bg-background ring-1 ring-border/50"
          : "w-full max-w-[340px] rounded-[24px] bg-bg-secondary p-1 shadow-[0_10px_30px_rgba(0,0,0,0.05)] ring-1 ring-border/50",
        className,
      )}
      data-recovery-card
      {...liveProps}
    >
      {variant === "inline" ? (
        <InlineRecoveryContent
          action={action}
          description={description}
          detail={detail}
          headingTag={headingTag}
          icon={Icon}
          title={title}
        />
      ) : (
        <StackedRecoveryContent
          action={action}
          description={description}
          detail={detail}
          headingTag={headingTag}
          icon={Icon}
          size={size}
          title={title}
        />
      )}
    </div>
  );
}

function InlineRecoveryContent({
  action,
  description,
  detail,
  headingTag: Heading,
  icon: Icon,
  title,
}: RecoveryContentProps) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 min-[540px]:flex-row min-[540px]:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-secondary text-fg-secondary ring-1 ring-border/50">
          <Icon aria-hidden="true" className="size-[17px]" strokeWidth={1.7} />
        </span>
        <div className="min-w-0">
          <Heading className="font-semibold text-[13px] text-foreground leading-5">{title}</Heading>
          <p className="text-pretty text-[12px] text-fg-secondary leading-[18px]">{description}</p>
          {detail ? (
            <p className="mt-1 break-all font-mono text-[10px] text-placeholder leading-4">
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <RecoveryCardAction action={action} variant="inline" /> : null}
    </div>
  );
}

function StackedRecoveryContent({
  action,
  description,
  detail,
  headingTag: Heading,
  icon: Icon,
  size,
  title,
}: RecoveryContentProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[20px] bg-background px-6 text-center ring-1 ring-border/50",
        size === "compact" ? "py-6" : "py-8",
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-[14px] bg-bg-secondary text-fg-secondary ring-1 ring-border/70">
        <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.7} />
      </span>
      <Heading className="mt-4 font-semibold text-[14px] text-foreground leading-5">
        {title}
      </Heading>
      <p className="mt-1.5 max-w-[260px] text-[12px] text-fg-secondary leading-[18px]">
        {description}
      </p>
      {detail ? (
        <p className="mt-2 max-w-[260px] break-all font-mono text-[10px] text-placeholder leading-4">
          {detail}
        </p>
      ) : null}
      {action ? <RecoveryCardAction action={action} variant="stacked" /> : null}
    </div>
  );
}

function RecoveryCardAction({
  action,
  variant,
}: {
  action: RecoveryAction;
  variant: NonNullable<RecoveryCardProps["variant"]>;
}) {
  const ActionIcon = action.icon;
  const className = cn(
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-foreground px-4 font-medium text-[12px] text-background transition-[background-color,transform] duration-150 hover:bg-foreground/90 active:scale-[0.97] motion-reduce:transition-none",
    variant === "inline" ? "w-full shrink-0 min-[540px]:w-auto" : "mt-5",
  );
  if ("href" in action) {
    return (
      <Link className={className} href={action.href}>
        {ActionIcon ? <ActionIcon aria-hidden="true" className="size-3.5" /> : null}
        {action.label}
      </Link>
    );
  }
  const isPending = action.isPending === true;
  return (
    <button
      aria-busy={isPending}
      className={cn(className, "disabled:cursor-wait disabled:opacity-65")}
      disabled={isPending}
      onClick={action.onClick}
      type="button"
    >
      {isPending ? (
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
      ) : ActionIcon ? (
        <ActionIcon aria-hidden="true" className="size-3.5" />
      ) : (
        <RefreshCw aria-hidden="true" className="size-3.5" />
      )}
      {isPending ? (action.pendingLabel ?? action.label) : action.label}
    </button>
  );
}

function recoveryLiveProps(announce: NonNullable<RecoveryCardProps["announce"]>) {
  if (announce === "off") return {};
  return announce === "assertive"
    ? ({ "aria-live": "assertive", role: "alert" } as const)
    : ({ "aria-live": "polite", role: "status" } as const);
}
