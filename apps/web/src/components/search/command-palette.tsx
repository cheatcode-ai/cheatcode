"use client";

import { SKILL_MANIFEST, type SkillManifestEntry } from "@cheatcode/skills/manifest";
import type { SearchResult } from "@cheatcode/types";
import { ModalShell } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { searchWorkspace } from "@/lib/api/search";
import { type NavItem, WORKSPACE_NAV } from "@/lib/navigation/nav-model";
import { useAppStore } from "@/lib/store/app-store";
import { emitCommandPaletteOpened } from "@/lib/telemetry/user-events";

const ROUTE_NAV_ITEMS = WORKSPACE_NAV.filter(
  (item) => item.status === "active" && item.target.kind === "route",
);

/**
 * ⌘K / Ctrl+K command palette mounted once in the app shell. Uses cmdk for
 * keyboard semantics inside the shared native-`<dialog>` `ModalShell` (one modal
 * mechanism product-wide). Server search results come pre-filtered (so cmdk's own
 * filtering is disabled); static nav + skill groups are filtered against the same
 * input.
 */
export function CommandPalette() {
  const open = useAppStore((state) => state.commandPaletteOpen);
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const { getToken } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = debouncedQuery.trim();
  const searchQuery = useQuery({
    enabled: open && trimmed.length >= 2,
    queryFn: () => searchWorkspace(getToken, trimmed),
    queryKey: ["workspace-search", trimmed],
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        const store = useAppStore.getState();
        const next = !store.commandPaletteOpen;
        store.setCommandPaletteOpen(next);
        if (next) {
          emitCommandPaletteOpened(getToken);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [getToken]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  const navMatches = ROUTE_NAV_ITEMS.filter((item) => matches(item.label, query));
  const skillMatches = SKILL_MANIFEST.filter((skill) => matchesSkill(skill, query));
  const results = searchQuery.data?.results ?? [];

  return (
    <ModalShell ariaLabel="Command palette" onClose={() => setOpen(false)} open={open}>
      <Command
        className="flex max-h-[60vh] flex-col font-mono"
        label="Command palette"
        shouldFilter={false}
      >
        <Command.Input
          className="w-full border-thread-border border-b bg-transparent px-4 py-3 text-sm text-thread-text-primary outline-none placeholder:text-thread-text-muted"
          onValueChange={setQuery}
          placeholder="Search projects, threads, skills…"
          ref={inputRef}
          value={query}
        />
        <Command.List className="chat-scrollbar overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-thread-text-muted text-xs">
            {searchQuery.isPending && trimmed.length >= 2 ? "Searching…" : "No results"}
          </Command.Empty>
          {results.length > 0 ? (
            <PaletteGroup heading="Results">
              {results.map((result) => (
                <ResultRow key={resultKey(result)} onNavigate={navigate} result={result} />
              ))}
            </PaletteGroup>
          ) : null}
          {navMatches.length > 0 ? (
            <PaletteGroup heading="Go to">
              {navMatches.map((item) => (
                <NavRow item={item} key={item.id} onNavigate={navigate} />
              ))}
            </PaletteGroup>
          ) : null}
          {skillMatches.length > 0 ? (
            <PaletteGroup heading="Skills">
              {skillMatches.map((skill) => (
                <PaletteItem
                  hint={skill.category}
                  key={skill.name}
                  label={skill.name}
                  onSelect={() => navigate(`/?skill=${encodeURIComponent(skill.name)}`)}
                  value={`skill-${skill.name}`}
                />
              ))}
            </PaletteGroup>
          ) : null}
        </Command.List>
      </Command>
    </ModalShell>
  );
}

function PaletteGroup({ children, heading }: { children: ReactNode; heading: string }) {
  return (
    <Command.Group
      className="px-1 pt-2 pb-1 text-[10px] text-thread-text-muted uppercase tracking-widest [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1"
      heading={heading}
    >
      {children}
    </Command.Group>
  );
}

function PaletteItem({
  disabled,
  hint,
  label,
  onSelect,
  value,
}: {
  disabled?: boolean;
  hint?: string | undefined;
  label: string;
  onSelect: () => void;
  value: string;
}) {
  return (
    <Command.Item
      className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-sm text-thread-text-secondary data-[selected=true]:bg-thread-surface-hover data-[selected=true]:text-thread-text-primary data-[disabled=true]:opacity-40"
      disabled={disabled ?? false}
      onSelect={onSelect}
      value={value}
    >
      <span className="min-w-0 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-[11px] text-thread-text-muted">{hint}</span> : null}
    </Command.Item>
  );
}

function ResultRow({
  onNavigate,
  result,
}: {
  onNavigate: (href: string) => void;
  result: SearchResult;
}) {
  if (result.type === "project") {
    const href = result.latestThreadId ? `/projects?thread=${result.latestThreadId}` : null;
    return (
      <PaletteItem
        disabled={href === null}
        hint="project"
        label={result.name}
        onSelect={() => {
          if (href) {
            onNavigate(href);
          }
        }}
        value={`project-${result.id}`}
      />
    );
  }
  return (
    <PaletteItem
      hint={result.projectName}
      label={result.title}
      onSelect={() => onNavigate(`/projects?thread=${result.id}`)}
      value={`thread-${result.id}`}
    />
  );
}

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate: (href: string) => void }) {
  if (item.target.kind !== "route") {
    return null;
  }
  const href = item.target.href;
  return (
    <PaletteItem label={item.label} onSelect={() => onNavigate(href)} value={`nav-${item.id}`} />
  );
}

function resultKey(result: SearchResult): string {
  return `${result.type}-${result.id}`;
}

function matches(label: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle.length === 0 || label.toLowerCase().includes(needle);
}

function matchesSkill(skill: SkillManifestEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return (
    skill.name.toLowerCase().includes(needle) ||
    skill.description.toLowerCase().includes(needle) ||
    skill.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
