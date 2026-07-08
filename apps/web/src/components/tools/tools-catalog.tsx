"use client";

import type {
  IntegrationName,
  ToolkitAction,
  ToolkitCatalogEntry,
  ToolkitCategory,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, RefreshCw, Search, Trash2, X } from "@/components/ui/icons";
import {
  connectIntegration,
  disconnectIntegration,
  fetchIntegrationCatalog,
  fetchToolkitActions,
  INTEGRATION_CATALOG_QUERY,
  INTEGRATIONS_QUERY,
} from "@/lib/api/integrations";
import { cn } from "@/lib/ui/cn";

type ConnectHandlers = {
  connectingName: IntegrationName | undefined;
  disconnectingName: IntegrationName | undefined;
  onConnect: (name: IntegrationName) => void;
  onDisconnect: (name: IntegrationName) => void;
};

const ALL_CATEGORY = "all";

export function ToolsCatalog() {
  const controller = useCatalogController();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [selectedName, setSelectedName] = useState<IntegrationName | null>(null);
  const lastSelectedRef = useRef<IntegrationName | null>(null);
  if (selectedName) {
    lastSelectedRef.current = selectedName;
  }

  const catalog = controller.query.data;
  const toolkits = catalog?.toolkits ?? [];
  const filtered = useMemo(
    () => filterToolkits(toolkits, category, search),
    [toolkits, category, search],
  );
  const displayedName = selectedName ?? lastSelectedRef.current;
  const displayed = displayedName
    ? toolkits.find((toolkit) => toolkit.name === displayedName)
    : undefined;
  const connectedCount = toolkits.filter((toolkit) => toolkit.status === "active").length;

  return (
    <div className="mt-8">
      <ToolsHeader
        connectedCount={connectedCount}
        onSearch={setSearch}
        search={search}
        total={toolkits.length}
      />
      <CategoryTabs
        categories={catalog?.categories ?? []}
        onSelect={setCategory}
        selected={category}
      />
      <ToolsGrid
        handlers={controller.handlers}
        isError={controller.query.isError}
        isPending={controller.query.isPending}
        onOpen={setSelectedName}
        onRetry={() => void controller.query.refetch()}
        toolkits={filtered}
      />
      <ToolDrawer
        handlers={controller.handlers}
        onClose={() => setSelectedName(null)}
        open={selectedName !== null}
        toolkit={displayed ?? null}
      />
    </div>
  );
}

function useCatalogController() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryFn: () => fetchIntegrationCatalog(getToken),
    queryKey: INTEGRATION_CATALOG_QUERY,
    staleTime: 60_000,
  });
  const connectMutation = useMutation({
    mutationFn: (name: IntegrationName) => connectIntegration(getToken, name),
    onError: (error) => toast.error(error.message),
    onSuccess: (oauthUrl) => window.location.assign(oauthUrl),
  });
  const disconnectMutation = useMutation({
    mutationFn: (name: IntegrationName) => disconnectIntegration(getToken, name),
    onError: (error) => toast.error(error.message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INTEGRATION_CATALOG_QUERY });
      void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_QUERY });
      toast.success("Tool disconnected");
    },
  });
  return {
    handlers: {
      connectingName: connectMutation.isPending ? connectMutation.variables : undefined,
      disconnectingName: disconnectMutation.isPending ? disconnectMutation.variables : undefined,
      onConnect: (name: IntegrationName) => connectMutation.mutate(name),
      onDisconnect: (name: IntegrationName) => disconnectMutation.mutate(name),
    } satisfies ConnectHandlers,
    query,
  };
}

function ToolsHeader({
  connectedCount,
  onSearch,
  search,
  total,
}: {
  connectedCount: number;
  onSearch: (value: string) => void;
  search: string;
  total: number;
}) {
  return (
    <div>
      <h1 className="font-bold text-[#1b1b1b] text-[30px] leading-9 tracking-[-0.01em]">Tools</h1>
      <p className="mt-2 text-[#5f5f5f] text-[15px] leading-6">
        Connect any Composio app and your agents can use it in chat.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block min-w-0 sm:w-[362px]" htmlFor="tools-search">
          <span className="sr-only">Search tools</span>
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-[#707070]"
          />
          <input
            className="h-8 w-full rounded-full border-0 bg-[#f7f7f7] pr-3 pl-10 font-medium text-[#1b1b1b] text-[14px] shadow-[0_0_0_2px_#fff,0_0_0_4px_#f7f7f7] outline-none placeholder:text-[#a0a0a0] focus:shadow-[0_0_0_2px_#fff,0_0_0_4px_#dedede]"
            id="tools-search"
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search by name"
            value={search}
          />
        </label>
        <div className="flex h-8 w-fit shrink-0 items-center rounded-full border border-[#f1f1f1] bg-white px-3 font-medium text-[#5f5f5f] text-[13px] leading-5">
          {connectedCount} connected{total > 0 ? ` · ${total} apps` : ""}
        </div>
      </div>
    </div>
  );
}

function CategoryTabs({
  categories,
  onSelect,
  selected,
}: {
  categories: readonly ToolkitCategory[];
  onSelect: (slug: string) => void;
  selected: string;
}) {
  if (categories.length === 0) {
    return null;
  }
  const tabs = [{ name: "All", slug: ALL_CATEGORY }, ...categories];
  return (
    <div className="scrollbar-hide mt-7 flex gap-1.5 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const active = tab.slug === selected;
        return (
          <button
            aria-pressed={active}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 font-medium text-[13px] leading-5 transition-colors",
              active
                ? "border-[#f1f1f1] bg-white text-[#1b1b1b]"
                : "border-transparent bg-white text-[#8a8a8a] hover:text-[#1b1b1b]",
            )}
            key={tab.slug}
            onClick={() => onSelect(tab.slug)}
            type="button"
          >
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}

function ToolsGrid({
  handlers,
  isError,
  isPending,
  onOpen,
  onRetry,
  toolkits,
}: {
  handlers: ConnectHandlers;
  isError: boolean;
  isPending: boolean;
  onOpen: (name: IntegrationName) => void;
  onRetry: () => void;
  toolkits: readonly ToolkitCatalogEntry[];
}) {
  if (isPending) {
    return <ToolsLoading />;
  }
  if (isError) {
    return <ToolsError onRetry={onRetry} />;
  }
  return (
    <div className="mt-7 grid gap-4 md:grid-cols-2">
      {toolkits.map((toolkit) => (
        <ToolCard handlers={handlers} key={toolkit.name} onOpen={onOpen} toolkit={toolkit} />
      ))}
      {toolkits.length === 0 ? (
        <p className="col-span-full mt-1 text-center text-[#8a8a8a] text-[14px]">
          No tools match your search
        </p>
      ) : null}
    </div>
  );
}

function ToolCard({
  handlers,
  onOpen,
  toolkit,
}: {
  handlers: ConnectHandlers;
  onOpen: (name: IntegrationName) => void;
  toolkit: ToolkitCatalogEntry;
}) {
  return (
    <button
      className="group rounded-[23px] border-2 border-[#f7f7f7] bg-white p-0.5 text-left transition-colors hover:border-[#ececec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/15"
      onClick={() => onOpen(toolkit.name)}
      type="button"
    >
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <BrandLogo displayName={toolkit.displayName} slug={toolkit.name} variant="card" />
        <p className="min-w-0 flex-1 truncate font-medium text-[#1b1b1b] text-[14px] leading-5">
          {toolkit.displayName}
        </p>
      </div>
      <div className="flex h-10 items-center justify-between gap-3 rounded-full bg-[#f7f7f7] px-4">
        <p className="line-clamp-1 min-w-0 text-[#707070] text-[13px] leading-5">
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
      <span className="flex shrink-0 items-center gap-1 text-[#8a8a8a] text-[13px] leading-5">
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex shrink-0 items-center gap-1 font-medium text-[#3f9442] text-[13px] leading-5">
        <Check aria-hidden="true" className="h-3.5 w-3.5" />
        Connected
      </span>
    );
  }
  const isAlert = status === "expired" || status === "failed";
  return (
    <span
      className={cn(
        "shrink-0 text-[13px] leading-5",
        isAlert ? "font-medium text-[#b4461f]" : "text-[#8a8a8a]",
      )}
    >
      {connectLabel(status)}
    </span>
  );
}

function BrandLogo({
  displayName,
  slug,
  variant,
}: {
  displayName: string;
  slug: string;
  variant: "card" | "drawer";
}) {
  const [failed, setFailed] = useState(false);
  const boxClass = variant === "drawer" ? "size-8" : "size-6";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-[0_0_0_1px_#ececec]",
        boxClass,
      )}
    >
      {failed ? (
        <span className="font-bold text-[#1b1b1b]/70 text-[10px]">{initials(displayName)}</span>
      ) : (
        <Image
          alt=""
          aria-hidden="true"
          className="size-4 object-contain"
          height={16}
          loading="eager"
          onError={() => setFailed(true)}
          src={`https://logos.composio.dev/api/${slug}`}
          unoptimized
          width={16}
        />
      )}
    </span>
  );
}

function ToolDrawer({
  handlers,
  onClose,
  open,
  toolkit,
}: {
  handlers: ConnectHandlers;
  onClose: () => void;
  open: boolean;
  toolkit: ToolkitCatalogEntry | null;
}) {
  const mounted = useMounted();
  useDrawerDismiss(open, onClose);
  if (!mounted) {
    return null;
  }
  return createPortal(
    <div
      aria-hidden={!open}
      className={cn("fixed inset-0 z-50", open ? null : "pointer-events-none")}
    >
      <DrawerScrim onClose={onClose} open={open} />
      <aside
        aria-label={toolkit ? `${toolkit.displayName} details` : undefined}
        aria-modal="true"
        className={cn(
          "fixed top-3 right-3 bottom-3 flex w-[460px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[20px] bg-[#f7f7f7] shadow-[0_0_0_2px_#fff,0_0_0_4px_#ededed,0_30px_60px_-24px_rgba(0,0,0,0.28)] transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-[calc(100%+1.5rem)]",
        )}
        role="dialog"
      >
        {toolkit ? (
          <DrawerContent handlers={handlers} onClose={onClose} open={open} toolkit={toolkit} />
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}

function DrawerScrim({ onClose, open }: { onClose: () => void; open: boolean }) {
  return (
    <button
      aria-label="Close tool details"
      className={cn(
        "absolute inset-0 bg-white/55 backdrop-blur-[2px] transition-opacity duration-300",
        open ? "opacity-100" : "opacity-0",
      )}
      onClick={onClose}
      tabIndex={open ? 0 : -1}
      type="button"
    />
  );
}

function useDrawerDismiss(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = previousOverflow;
    };
  }, [open]);
}

function DrawerContent({
  handlers,
  onClose,
  open,
  toolkit,
}: {
  handlers: ConnectHandlers;
  onClose: () => void;
  open: boolean;
  toolkit: ToolkitCatalogEntry;
}) {
  return (
    <>
      <DrawerHeader onClose={onClose} toolkit={toolkit} />
      <div className="chat-scrollbar flex-1 overflow-y-auto px-5 pt-4 pb-6">
        <p className="text-[#5f5f5f] text-[14px] leading-[21px]">
          {toolkit.description || `Connect ${toolkit.displayName} to use it from chat.`}
        </p>
        <DrawerActionsBar handlers={handlers} toolkit={toolkit} />
        <DrawerActions enabled={open} name={toolkit.name} onNavigate={onClose} />
      </div>
    </>
  );
}

function DrawerActions({
  enabled,
  name,
  onNavigate,
}: {
  enabled: boolean;
  name: IntegrationName;
  onNavigate: () => void;
}) {
  const { getToken } = useAuth();
  const query = useQuery({
    enabled,
    queryFn: () => fetchToolkitActions(getToken, name),
    queryKey: ["toolkit-actions", name],
    staleTime: 300_000,
  });
  if (query.isPending && enabled) {
    return <ActionsLoading />;
  }
  const actions = query.data ?? [];
  if (actions.length === 0) {
    return null;
  }
  return (
    <div className="mt-8">
      <p className="mb-3 font-medium text-[#8a8a8a] text-[13px] leading-5">Actions</p>
      <div className="flex flex-col">
        {actions.map((action, index) => (
          <ActionRow
            action={action}
            isLast={index === actions.length - 1}
            key={action.slug}
            name={name}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

function ActionRow({
  action,
  isLast,
  name,
  onNavigate,
}: {
  action: ToolkitAction;
  isLast: boolean;
  name: IntegrationName;
  onNavigate: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const href = `/?tool=${encodeURIComponent(name)}&prompt=${encodeURIComponent(action.name)}`;
  return (
    <Link
      className={cn("relative flex gap-3", isLast ? null : "pb-5")}
      href={href}
      onBlur={() => setIsHovered(false)}
      onClick={onNavigate}
      onFocus={() => setIsHovered(true)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isLast ? null : (
        <span
          aria-hidden="true"
          className="absolute top-4 -bottom-4 left-[9.5px] w-px bg-[#e6e6e6]"
        />
      )}
      <ActionMarker isHovered={isHovered} />
      <span className="min-w-0 flex-1 py-1.5">
        <span className="block font-medium text-[#1b1b1b] text-[14px] leading-5">
          {action.name}
        </span>
        {action.description ? (
          <span className="mt-1 line-clamp-2 block text-[#8a8a8a] text-[13px] leading-[19px]">
            {action.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function ActionMarker({ isHovered }: { isHovered: boolean }) {
  return (
    <span
      className="relative z-10 mt-1.5 flex size-5 shrink-0 items-center justify-center bg-[#f7f7f7]"
      style={{ color: isHovered ? "#1b1b1b" : "#b4b4b4", transition: "color 0.15s ease" }}
    >
      <svg
        aria-hidden="true"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" />
        {isHovered ? <path d="M12 8v8M16 12H8" /> : <circle cx="12" cy="12" r="1" />}
      </svg>
    </span>
  );
}

function ActionsLoading() {
  return (
    <div className="mt-8">
      <div className="mb-3 h-3.5 w-16 animate-pulse rounded-full bg-[#ededed]" />
      <div className="flex flex-col gap-3">
        {LOADING_KEYS.slice(0, 4).map((key) => (
          <div className="h-9 animate-pulse rounded-[10px] bg-[#efefef]" key={key} />
        ))}
      </div>
    </div>
  );
}

function DrawerHeader({ onClose, toolkit }: { onClose: () => void; toolkit: ToolkitCatalogEntry }) {
  return (
    <header className="flex items-center gap-2.5 border-[#ececec] border-b px-5 py-3.5">
      <BrandLogo displayName={toolkit.displayName} slug={toolkit.name} variant="drawer" />
      <h2 className="min-w-0 flex-1 truncate font-semibold text-[#1b1b1b] text-[16px] leading-6">
        {toolkit.displayName}
      </h2>
      <button
        aria-label="Close"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#8a8a8a] transition-colors hover:bg-white hover:text-[#1b1b1b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/15"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </header>
  );
}

function DrawerActionsBar({
  handlers,
  toolkit,
}: {
  handlers: ConnectHandlers;
  toolkit: ToolkitCatalogEntry;
}) {
  const isActive = toolkit.status === "active";
  const isConnecting = handlers.connectingName === toolkit.name;
  const isDisconnecting = handlers.disconnectingName === toolkit.name;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {isActive ? (
          <>
            <Link
              className="inline-flex h-9 items-center justify-center rounded-full bg-[#1b1b1b] px-4 font-medium text-[13px] text-white transition-colors hover:bg-black"
              href={`/?tool=${encodeURIComponent(toolkit.name)}`}
            >
              Use in chat
            </Link>
            <DisconnectButton
              isDisconnecting={isDisconnecting}
              onDisconnect={() => handlers.onDisconnect(toolkit.name)}
            />
          </>
        ) : toolkit.connectable ? (
          <ConnectButton
            isConnecting={isConnecting}
            onConnect={() => handlers.onConnect(toolkit.name)}
            status={toolkit.status}
          />
        ) : (
          <span className="inline-flex h-9 items-center rounded-full bg-[#f0f0f0] px-4 font-medium text-[#8a8a8a] text-[13px]">
            Needs your own credentials
          </span>
        )}
      </div>
      <p className="mt-2.5 text-[#8a8a8a] text-[12px] leading-4">
        {!isActive && !toolkit.connectable
          ? "This app uses its own API key or OAuth — set it up in Composio, then it appears here."
          : statusDetailLine(toolkit)}
      </p>
    </div>
  );
}

function ConnectButton({
  isConnecting,
  onConnect,
  status,
}: {
  isConnecting: boolean;
  onConnect: () => void;
  status: ToolkitCatalogEntry["status"];
}) {
  return (
    <button
      className="inline-flex h-9 items-center justify-center rounded-full bg-[#1b1b1b] px-4 font-medium text-[13px] text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-45"
      disabled={isConnecting}
      onClick={onConnect}
      type="button"
    >
      {isConnecting ? (
        <Loader2 aria-hidden="true" className="mr-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <ExternalLink aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
      )}
      {connectLabel(status)}
    </button>
  );
}

function DisconnectButton({
  isDisconnecting,
  onDisconnect,
}: {
  isDisconnecting: boolean;
  onDisconnect: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center justify-center rounded-full px-4 font-medium text-[#5f5f5f] text-[13px] transition-colors hover:bg-white hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-45"
      disabled={isDisconnecting}
      onClick={onDisconnect}
      type="button"
    >
      {isDisconnecting ? (
        <Loader2 aria-hidden="true" className="mr-2 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
      )}
      Disconnect
    </button>
  );
}

function ToolsLoading() {
  return (
    <div className="mt-7 grid gap-4 md:grid-cols-2">
      {LOADING_KEYS.map((key) => (
        <div
          className="h-[92px] animate-pulse rounded-[23px] border-2 border-[#f7f7f7] bg-[#fbfbfb]"
          key={key}
        />
      ))}
    </div>
  );
}

function ToolsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-7 rounded-[23px] border-2 border-[#f7f7f7] bg-white p-1">
      <div className="flex flex-col gap-4 rounded-[20px] bg-[#fbfbfb] p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[#707070] text-[14px] leading-5">The tools catalog is unavailable.</p>
        <button
          className="inline-flex h-9 w-fit items-center justify-center rounded-full bg-[#1b1b1b] px-4 font-medium text-[13px] text-white"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    </div>
  );
}

function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

const LOADING_KEYS = ["a", "b", "c", "d", "e", "f"] as const;

function filterToolkits(
  toolkits: readonly ToolkitCatalogEntry[],
  category: string,
  search: string,
): ToolkitCatalogEntry[] {
  const needle = search.trim().toLowerCase();
  return toolkits.filter((toolkit) => {
    if (category !== ALL_CATEGORY && !toolkit.categorySlugs.includes(category)) {
      return false;
    }
    if (needle.length === 0) {
      return true;
    }
    return (
      toolkit.displayName.toLowerCase().includes(needle) ||
      toolkit.description.toLowerCase().includes(needle)
    );
  });
}

function connectLabel(status: ToolkitCatalogEntry["status"]): string {
  if (status === "initiating") {
    return "Continue";
  }
  if (status === "expired" || status === "failed" || status === "inactive") {
    return "Reconnect";
  }
  return "Connect";
}

const STATUS_DETAIL: Record<ToolkitCatalogEntry["status"], string> = {
  active: "Connected",
  expired: "Connection expired — reconnect to continue",
  failed: "Connection failed — reconnect to continue",
  inactive: "Disconnected",
  initiating: "Finishing connection…",
  not_connected: "Not connected",
};

function statusDetailLine(toolkit: ToolkitCatalogEntry): string {
  const label = STATUS_DETAIL[toolkit.status];
  if (toolkit.status === "active" && toolkit.updatedAt) {
    return `${label} · updated ${formatDate(toolkit.updatedAt)}`;
  }
  return label;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const joined = words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
  return joined || "?";
}
