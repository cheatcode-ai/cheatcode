"use client";

import type {
  IntegrationAccount,
  IntegrationName,
  ToolkitAction,
  ToolkitCatalogEntry,
} from "@cheatcode/types";
import { FileText, Loader2, ModalShell, Pencil, Plus, Search, Trash2, X } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { PromptLaunchButton } from "@/components/navigation/prompt-launch-button";
import { IntegrationBrandLogo } from "@/components/skills/integration-brand-logo";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { fetchToolkitActions } from "@/lib/api/integrations";
import { cn } from "@/lib/ui/cn";

export interface IntegrationDrawerHandlers {
  connectingName: IntegrationName | undefined;
  disconnectingId: string | undefined;
  defaultingId: string | undefined;
  onConnect: (name: IntegrationName) => void;
  onDisconnect: (name: IntegrationName, connectionId: string) => void;
  onMakeDefault: (name: IntegrationName, connectionId: string) => void;
}

export function IntegrationSkillDrawer({
  handlers,
  onClose,
  open,
  toolkit,
}: {
  handlers: IntegrationDrawerHandlers;
  onClose: () => void;
  open: boolean;
  toolkit: ToolkitCatalogEntry | null;
}) {
  return (
    <ModalShell
      className="fixed top-3 right-3 bottom-3 left-auto m-0 flex h-auto w-[460px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border-0 bg-secondary shadow-[0_12px_32px_rgba(0,0,0,.12)] ring-2 ring-border ring-offset-2 ring-offset-background backdrop:bg-background/70 backdrop:backdrop-blur-[3px]"
      labelledBy="integration-skill-drawer-title"
      onClose={onClose}
      open={open}
    >
      {toolkit ? (
        <DrawerContent handlers={handlers} onClose={onClose} open={open} toolkit={toolkit} />
      ) : null}
    </ModalShell>
  );
}

function DrawerContent({
  handlers,
  onClose,
  open,
  toolkit,
}: {
  handlers: IntegrationDrawerHandlers;
  onClose: () => void;
  open: boolean;
  toolkit: ToolkitCatalogEntry;
}) {
  return (
    <div className="relative flex-1 overflow-hidden">
      <header className="flex h-[57px] items-center gap-1.5 border-border border-b px-4 py-3">
        <IntegrationBrandLogo displayName={toolkit.displayName} size="drawer" slug={toolkit.name} />
        <h2
          className="min-w-0 flex-1 truncate font-semibold text-base text-foreground leading-6"
          id="integration-skill-drawer-title"
        >
          {toolkit.displayName}
        </h2>
        <button
          aria-label="Close skill details"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-background hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>
      <div className="chat-scrollbar h-[calc(100%-57px)] overflow-y-auto overscroll-contain px-6 pb-6">
        <div className="grid gap-10">
          <ConnectionIntro handlers={handlers} toolkit={toolkit} />
          {toolkit.accounts.length > 0 ? (
            <ConnectedAccounts handlers={handlers} toolkit={toolkit} />
          ) : null}
        </div>
        <ToolkitActions enabled={open} toolkit={toolkit} />
      </div>
    </div>
  );
}

function ConnectionIntro({
  handlers,
  toolkit,
}: {
  handlers: IntegrationDrawerHandlers;
  toolkit: ToolkitCatalogEntry;
}) {
  const isConnecting = handlers.connectingName === toolkit.name;
  return (
    <section className="rounded-3xl border border-transparent p-0">
      <p className="text-fg-secondary text-sm leading-5">
        {toolkit.description || `Connect ${toolkit.displayName} to use it from chat.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="relative inline-flex h-8 items-center justify-center gap-2 overflow-hidden rounded-full bg-foreground px-4 py-2 font-medium text-background text-sm shadow-[inset_0_1px_0_rgba(255,255,255,.15),0_1px_3px_rgba(0,0,0,.2)] transition-[transform,background-color] duration-200 ease-out before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/20 before:opacity-50 before:transition-opacity hover:bg-foreground/90 hover:before:opacity-0 active:scale-[.99] disabled:pointer-events-none disabled:opacity-50"
          disabled={isConnecting || !toolkit.connectable}
          onClick={() => handlers.onConnect(toolkit.name)}
          type="button"
        >
          {isConnecting ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {toolkit.accounts.length > 0 ? "Add account" : "Connect"}
        </button>
      </div>
    </section>
  );
}

function ConnectedAccounts({
  handlers,
  toolkit,
}: {
  handlers: IntegrationDrawerHandlers;
  toolkit: ToolkitCatalogEntry;
}) {
  return (
    <section>
      <p className="mb-3 text-fg-secondary text-sm leading-5">Connected accounts</p>
      <div className="grid gap-3">
        {toolkit.accounts.map((account) => (
          <ConnectedAccountRow
            account={account}
            handlers={handlers}
            key={account.connectionId}
            toolkit={toolkit}
          />
        ))}
        {toolkit.accounts.length > 1 ? (
          <div className="rounded-[14px] bg-background px-4 py-3 text-fg-secondary text-sm leading-5 shadow-[0_0_0_1px_#ededed] dark:bg-input/30 dark:shadow-[0_0_0_1px_rgba(247,247,247,.02),0_1px_2px_-1px_rgba(247,247,247,.02),0_2px_4px_rgba(247,247,247,.01)]">
            Use the most recent active account automatically
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ConnectedAccountRow({
  account,
  handlers,
  toolkit,
}: {
  account: IntegrationAccount;
  handlers: IntegrationDrawerHandlers;
  toolkit: ToolkitCatalogEntry;
}) {
  const isDisconnecting = handlers.disconnectingId === account.connectionId;
  const isDefaulting = handlers.defaultingId === account.connectionId;
  return (
    <article className="rounded-xl bg-transparent py-1">
      <div className="flex min-w-0 flex-col gap-3">
        <ConnectedAccountSummary
          account={account}
          handlers={handlers}
          isDisconnecting={isDisconnecting}
          toolkit={toolkit}
        />
        {!account.isDefault && account.status === "active" ? (
          <MakeDefaultButton
            account={account}
            handlers={handlers}
            isDefaulting={isDefaulting}
            toolkit={toolkit}
          />
        ) : null}
      </div>
    </article>
  );
}

function ConnectedAccountSummary({
  account,
  handlers,
  isDisconnecting,
  toolkit,
}: {
  account: IntegrationAccount;
  handlers: IntegrationDrawerHandlers;
  isDisconnecting: boolean;
  toolkit: ToolkitCatalogEntry;
}) {
  return (
    <div className="min-w-0 flex-1 text-left">
      <div className="flex min-h-7 items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-medium text-foreground text-sm leading-5">
          {account.label}
        </p>
        {account.isDefault ? (
          <span className="inline-flex h-7 items-center rounded-full bg-background px-2.5 font-medium text-[13px] text-success-fg shadow-[0_0_0_1px_var(--border-subtle)]">
            Default
          </span>
        ) : null}
        <button
          className="inline-flex h-7 items-center justify-center rounded-full bg-background px-2.5 font-medium text-[13px] text-fg-secondary shadow-[0_0_0_1px_#ededed,0_1px_2px_-1px_rgba(0,0,0,.04)] transition-colors duration-200 hover:bg-bg-elevated hover:text-foreground active:scale-[.99] disabled:opacity-50 dark:bg-input/30 dark:shadow-[0_0_0_1px_rgba(247,247,247,.02),0_1px_2px_-1px_rgba(247,247,247,.02),0_2px_4px_rgba(247,247,247,.01)] dark:hover:bg-input/50"
          disabled={isDisconnecting}
          onClick={() => handlers.onDisconnect(toolkit.name, account.connectionId)}
          type="button"
        >
          {isDisconnecting ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            "Disconnect"
          )}
        </button>
      </div>
      <p className="mt-1 text-placeholder text-sm leading-5">{accountDescription(account)}</p>
    </div>
  );
}

function MakeDefaultButton({
  account,
  handlers,
  isDefaulting,
  toolkit,
}: {
  account: IntegrationAccount;
  handlers: IntegrationDrawerHandlers;
  isDefaulting: boolean;
  toolkit: ToolkitCatalogEntry;
}) {
  return (
    <button
      className="inline-flex h-8 w-fit items-center justify-center rounded-full bg-background px-3 font-medium text-foreground text-sm shadow-[0_0_0_1px_#ededed] transition-colors duration-200 hover:bg-bg-elevated active:scale-[.99] disabled:opacity-50 dark:bg-background/50 dark:shadow-[0_0_0_1px_rgba(247,247,247,.02),0_1px_2px_-1px_rgba(247,247,247,.02),0_2px_4px_rgba(247,247,247,.01)] dark:hover:bg-bg-secondary"
      disabled={isDefaulting}
      onClick={() => handlers.onMakeDefault(toolkit.name, account.connectionId)}
      type="button"
    >
      {isDefaulting ? (
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
      ) : (
        "Make default"
      )}
    </button>
  );
}

function ToolkitActions({ enabled, toolkit }: { enabled: boolean; toolkit: ToolkitCatalogEntry }) {
  const { getToken } = useAuth();
  const query = useQuery({
    enabled,
    queryFn: ({ signal }) => fetchToolkitActions(getToken, toolkit.name, signal),
    queryKey: ["toolkit-actions", toolkit.name],
    staleTime: 300_000,
  });
  if (query.isPending && enabled) {
    return <ToolkitActionsLoading />;
  }
  const actions = query.data ?? [];
  if (actions.length === 0) {
    return null;
  }
  return (
    <section className="mt-10">
      <p className="mb-3 text-fg-secondary text-sm leading-5">Actions</p>
      <div className="ml-5">
        {actions.map((action, index) => (
          <ActionRow
            action={action}
            isLast={index === actions.length - 1}
            key={action.slug}
            toolkit={toolkit}
          />
        ))}
      </div>
    </section>
  );
}

function ActionRow({
  action,
  isLast,
  toolkit,
}: {
  action: ToolkitAction;
  isLast: boolean;
  toolkit: ToolkitCatalogEntry;
}) {
  const Icon = actionIcon(action.slug);
  const example = actionExample(action);
  return (
    <div className={cn("relative", isLast ? null : "pb-6")}>
      {isLast ? null : (
        <span className="absolute top-2 bottom-0 -left-5 w-[1.5px] bg-border-tree" />
      )}
      <span className="absolute top-0 -left-5 h-[18px] w-4 rounded-bl-lg border-border-tree border-b-[1.5px] border-l-[1.5px]" />
      <PromptLaunchButton
        className="group block cursor-pointer rounded-xl px-2 py-1 transition-colors duration-150 hover:bg-background active:bg-background"
        prompt={example}
        query={{ tool: toolkit.name }}
      >
        <span className="mt-[3px] flex items-start gap-3">
          <span className="flex size-5 shrink-0 items-center justify-center text-fg-secondary">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block font-medium text-foreground text-sm leading-5">
              {action.name}
            </span>
            <span className="mt-1.5 line-clamp-2 block text-fg-secondary text-sm leading-5">
              “{example}”
            </span>
          </span>
        </span>
      </PromptLaunchButton>
    </div>
  );
}

function ToolkitActionsLoading() {
  return <CheatcodeLoader className="mt-10 min-h-[224px]" label="Loading skill actions" />;
}

function actionIcon(slug: string) {
  const normalized = slug.toLowerCase();
  if (normalized.includes("delete") || normalized.includes("remove")) {
    return Trash2;
  }
  if (normalized.includes("update") || normalized.includes("edit")) {
    return Pencil;
  }
  if (normalized.includes("find") || normalized.includes("search")) {
    return Search;
  }
  if (normalized.includes("create") || normalized.includes("add")) {
    return Plus;
  }
  return FileText;
}

function actionExample(action: ToolkitAction): string {
  const description = action.description
    .trim()
    .replace(/^[-–—\s]+/, "")
    .replace(/\s+/g, " ");
  if (!description) {
    return action.name;
  }
  const firstSentence = description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  return firstSentence ?? description;
}

function accountDescription(account: IntegrationAccount): string {
  if (account.isDefault) {
    return "Saved as the default connected account.";
  }
  if (account.status === "active") {
    return "Available to use across your tools.";
  }
  if (account.status === "initiating") {
    return "Waiting for authentication to finish.";
  }
  if (account.status === "expired") {
    return "Authentication expired. Connect this account again.";
  }
  return "This account is not currently available.";
}
