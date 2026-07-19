import type { IntegrationName, ToolkitCatalogEntry, UserSkill } from "@cheatcode/types";
import { Loader2, Sparkles } from "@cheatcode/ui";
import { IntegrationBrandLogo } from "@/components/skills/integration-brand-logo";
import type { IntegrationDrawerHandlers } from "@/components/skills/integration-skill-drawer";
import { UserSkillCard, type UserSkillsCatalog } from "@/components/skills/user-skills-section";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { cn } from "@/lib/ui/cn";

export function ToolsGrid({
  handlers,
  isError,
  isPending,
  isRetrying,
  onOpen,
  onRetry,
  toolkits,
  userSkills,
  userSkillsCatalog,
}: {
  handlers: IntegrationDrawerHandlers;
  isError: boolean;
  isPending: boolean;
  isRetrying: boolean;
  onOpen: (name: IntegrationName) => void;
  onRetry: () => void;
  toolkits: readonly ToolkitCatalogEntry[];
  userSkills: readonly UserSkill[];
  userSkillsCatalog: UserSkillsCatalog;
}) {
  if (isPending && userSkills.length === 0) {
    return <ToolsCatalogLoading />;
  }
  if (isError && userSkills.length === 0) {
    return <ToolsError isRetrying={isRetrying} onRetry={onRetry} />;
  }
  return (
    <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {userSkills.map((skill) => (
        <UserSkillCard
          deleteMutation={userSkillsCatalog.deleteMutation}
          key={skill.id}
          onOpen={userSkillsCatalog.openSkill}
          skill={skill}
        />
      ))}
      {isPending ? <InlineCatalogLoading /> : null}
      {isError ? <InlineToolsError isRetrying={isRetrying} onRetry={onRetry} /> : null}
      {isPending || isError
        ? null
        : toolkits.map((toolkit) => (
            <ToolCard handlers={handlers} key={toolkit.name} onOpen={onOpen} toolkit={toolkit} />
          ))}
      {!isPending && !isError && toolkits.length === 0 && userSkills.length === 0 ? (
        <p className="col-span-full mt-1 text-center text-placeholder text-sm">
          No skills match your search
        </p>
      ) : null}
    </div>
  );
}

function InlineCatalogLoading() {
  return (
    <div className="col-span-full min-h-36">
      <CheatcodeLoader className="min-h-36" label="Loading skills catalog" />
    </div>
  );
}

function InlineToolsError({ isRetrying, onRetry }: { isRetrying: boolean; onRetry: () => void }) {
  return (
    <div className="col-span-full flex min-h-40 items-center justify-center rounded-[24px] bg-bg-secondary p-5">
      <RecoveryCard
        action={{
          isPending: isRetrying,
          label: "Reload skills",
          onClick: onRetry,
          pendingLabel: "Loading skills…",
        }}
        description="Cheatcode couldn't reach the skills catalog. Check your connection and try again."
        icon={Sparkles}
        size="compact"
        title="Skills couldn't load"
      />
    </div>
  );
}

function ToolCard({
  handlers,
  onOpen,
  toolkit,
}: {
  handlers: IntegrationDrawerHandlers;
  onOpen: (name: IntegrationName) => void;
  toolkit: ToolkitCatalogEntry;
}) {
  return (
    <button
      className="group rounded-[23px] border-2 border-secondary bg-background p-0.5 text-left transition-colors duration-150 hover:border-border"
      onClick={() => onOpen(toolkit.name)}
      type="button"
    >
      <div className="flex h-11 items-center gap-3 px-3.5 py-2.5">
        <IntegrationBrandLogo displayName={toolkit.displayName} slug={toolkit.name} />
        <p className="min-w-0 flex-1 truncate font-medium text-foreground text-sm leading-5">
          {toolkit.displayName}
        </p>
      </div>
      <div
        className={cn(
          "flex h-10 items-center justify-between gap-3 rounded-full bg-secondary pl-4",
          toolkit.status === "active" ? "pr-2" : "pr-4",
        )}
      >
        <p className="line-clamp-1 min-w-0 text-[13px] text-fg-secondary leading-5">
          {toolkit.description || "Composio integration"}
        </p>
        <CardStatus busy={handlers.connectingName === toolkit.name} status={toolkit.status} />
      </div>
    </button>
  );
}

function CardStatus({ busy, status }: { busy: boolean; status: ToolkitCatalogEntry["status"] }) {
  if (busy) {
    return (
      <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-placeholder" />
    );
  }
  return status === "active" ? (
    <span className="inline-flex shrink-0 items-center rounded-full bg-background px-2.5 py-1 font-medium text-[13px] text-success-fg leading-[19.5px]">
      Enabled
    </span>
  ) : (
    <span className="shrink-0 text-[13px] text-fg-secondary leading-5">
      {status === "initiating" ? "Continue" : "Connect"}
    </span>
  );
}

function ToolsCatalogLoading() {
  return <CheatcodeLoader className="mt-7 min-h-[308px]" label="Loading skills catalog" />;
}

function ToolsError({ isRetrying, onRetry }: { isRetrying: boolean; onRetry: () => void }) {
  return (
    <div className="mt-8 flex min-h-52 items-center justify-center rounded-[24px] bg-bg-secondary p-5">
      <RecoveryCard
        action={{
          isPending: isRetrying,
          label: "Reload skills",
          onClick: onRetry,
          pendingLabel: "Loading skills…",
        }}
        description="Cheatcode couldn't reach the skills catalog. Check your connection and try again."
        icon={Sparkles}
        size="compact"
        title="Skills couldn't load"
      />
    </div>
  );
}
