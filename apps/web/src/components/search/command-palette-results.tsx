import type { SearchResult } from "@cheatcode/types";
import { Command } from "cmdk";
import type { useCommandPalette } from "./use-command-palette";

type Palette = ReturnType<typeof useCommandPalette>;
type ProjectResult = Extract<SearchResult, { type: "project" }>;
type ThreadResult = Extract<SearchResult, { type: "thread" }>;

const GROUP_CLASS =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-placeholder [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide";

export function CommandPaletteResults({ palette }: { palette: Palette }) {
  return (
    <Command.List className="chat-scrollbar flex-1 overflow-y-auto p-2">
      <CommandPaletteStatus palette={palette} />
      {palette.projects.length > 0 ? (
        <ProjectResults navigate={palette.navigate} projects={palette.projects} />
      ) : null}
      {palette.threads.length > 0 ? (
        <ThreadResults navigate={palette.navigate} threads={palette.threads} />
      ) : null}
    </Command.List>
  );
}

function CommandPaletteStatus({ palette }: { palette: Palette }) {
  if (palette.trimmed.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-[13px] text-placeholder">
        Type to search your projects and threads.
      </p>
    );
  }
  if (palette.searchResults.isFetching && palette.results.length === 0) {
    return <p className="px-2 py-6 text-center text-[13px] text-placeholder">Searching…</p>;
  }
  return palette.results.length === 0 ? (
    <Command.Empty className="px-2 py-6 text-center text-[13px] text-placeholder">
      No results for “{palette.trimmed}”.
    </Command.Empty>
  ) : null;
}

function ProjectResults({
  navigate,
  projects,
}: {
  navigate: (href: string) => void;
  projects: ProjectResult[];
}) {
  return (
    <Command.Group className={GROUP_CLASS} heading="Projects">
      {projects.map((project) => (
        <Command.Item
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[14px] data-[selected=true]:bg-secondary"
          key={project.id}
          onSelect={() =>
            navigate(project.latestThreadId ? `/chats/${project.latestThreadId}` : "/")
          }
          value={`project-${project.id}`}
        >
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
        </Command.Item>
      ))}
    </Command.Group>
  );
}

function ThreadResults({
  navigate,
  threads,
}: {
  navigate: (href: string) => void;
  threads: ThreadResult[];
}) {
  return (
    <Command.Group className={GROUP_CLASS} heading="Threads">
      {threads.map((thread) => (
        <Command.Item
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[14px] data-[selected=true]:bg-secondary"
          key={thread.id}
          onSelect={() => navigate(`/chats/${thread.id}`)}
          value={`thread-${thread.id}`}
        >
          <span className="min-w-0 flex-1 truncate">{thread.title || "New chat"}</span>
          <span className="shrink-0 truncate text-[12px] text-placeholder">
            {thread.projectName}
          </span>
        </Command.Item>
      ))}
    </Command.Group>
  );
}
