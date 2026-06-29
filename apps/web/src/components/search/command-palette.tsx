"use client";

import { ModalShell } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "@/components/ui/icons";
import { searchWorkspace } from "@/lib/api/search";

/** Dispatch on `window` to open the palette from any UI affordance (e.g. a Search button). */
export const OPEN_COMMAND_PALETTE_EVENT = "cheatcode:open-command-palette";

/**
 * Global ⌘K / Ctrl+K command palette. Mounted once in the app providers. Backed
 * by the real `GET /v1/search` (projects + threads only — message text and files
 * are intentionally out of scope server-side, so we never imply file results).
 * cmdk's built-in filtering is disabled (`shouldFilter={false}`) because matching
 * happens server-side; cmdk only owns keyboard navigation + selection.
 */
export function CommandPalette() {
  const { getToken, isSignedIn } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    // Any UI affordance can open the palette by dispatching this event.
    const onOpenRequest = () => setOpen(true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const searchResults = useQuery({
    enabled: open && Boolean(isSignedIn) && trimmed.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => searchWorkspace(getToken, trimmed),
    queryKey: ["command-palette-search", trimmed],
    staleTime: 10_000,
  });

  const results = searchResults.data?.results ?? [];
  const projects = results.filter((result) => result.type === "project");
  const threads = results.filter((result) => result.type === "thread");

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!isSignedIn) {
    return null;
  }

  return (
    <ModalShell
      ariaLabel="Search projects and threads"
      className="m-auto w-full max-w-xl"
      onClose={() => setOpen(false)}
      open={open}
    >
      <Command
        className="flex max-h-[60vh] flex-col overflow-hidden text-[#1b1b1b]"
        label="Search projects and threads"
        shouldFilter={false}
      >
        <div className="flex items-center gap-2 border-[#f0f0f0] border-b px-4">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[#a0a0a0]" />
          <Command.Input
            className="h-12 w-full bg-transparent text-[#1b1b1b] text-[14px] outline-none placeholder:text-[#a0a0a0]"
            onValueChange={setQuery}
            placeholder="Search projects and threads…"
            value={query}
          />
        </div>
        <Command.List className="chat-scrollbar flex-1 overflow-y-auto p-2">
          {trimmed.length === 0 ? (
            <p className="px-2 py-6 text-center text-[#a0a0a0] text-[13px]">
              Type to search your projects and threads.
            </p>
          ) : searchResults.isFetching && results.length === 0 ? (
            <p className="px-2 py-6 text-center text-[#a0a0a0] text-[13px]">Searching…</p>
          ) : results.length === 0 ? (
            <Command.Empty className="px-2 py-6 text-center text-[#a0a0a0] text-[13px]">
              No results for “{trimmed}”.
            </Command.Empty>
          ) : null}

          {projects.length > 0 ? (
            <Command.Group
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#a0a0a0] [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide"
              heading="Projects"
            >
              {projects.map((project) => (
                <Command.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[14px] data-[selected=true]:bg-[#f7f7f7]"
                  key={project.id}
                  onSelect={() =>
                    navigate(
                      project.latestThreadId
                        ? `/projects?thread=${project.latestThreadId}`
                        : "/projects",
                    )
                  }
                  value={`project-${project.id}`}
                >
                  <span className="min-w-0 flex-1 truncate">{project.name || "Untitled"}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}

          {threads.length > 0 ? (
            <Command.Group
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[#a0a0a0] [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide"
              heading="Threads"
            >
              {threads.map((thread) => (
                <Command.Item
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[14px] data-[selected=true]:bg-[#f7f7f7]"
                  key={thread.id}
                  onSelect={() => navigate(`/projects?thread=${thread.id}`)}
                  value={`thread-${thread.id}`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {thread.title || "Untitled thread"}
                  </span>
                  <span className="shrink-0 truncate text-[#a0a0a0] text-[12px]">
                    {thread.projectName}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </ModalShell>
  );
}
