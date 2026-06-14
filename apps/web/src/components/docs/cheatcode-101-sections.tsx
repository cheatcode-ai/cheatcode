import type { Cheatcode101Block, Cheatcode101Section } from "@/content/cheatcode-101";

export function Cheatcode101Toc({ sections }: { sections: readonly Cheatcode101Section[] }) {
  return (
    <nav aria-label="cheatcode 101 sections" className="text-sm">
      <p className="mb-3 font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.24em]">
        On this page
      </p>
      <ol className="space-y-2">
        {sections.map((section, index) => (
          <li key={section.id}>
            <a
              className="text-thread-text-secondary transition-colors hover:text-thread-text-primary"
              href={`#${section.id}`}
            >
              {`${index + 1}. ${section.title}`}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Cheatcode101SectionView({ section }: { section: Cheatcode101Section }) {
  return (
    <section
      className="scroll-mt-24 border-thread-border-subtle border-t pt-8 first:border-t-0 first:pt-0"
      id={section.id}
    >
      <h2 className="flex items-center gap-3 font-medium text-white text-xl tracking-tight">
        {section.title}
        {section.draft ? (
          <span className="rounded-full border border-thread-border bg-black/25 px-2 py-0.5 font-mono text-[9px] text-thread-text-muted uppercase tracking-[0.18em]">
            draft
          </span>
        ) : null}
      </h2>
      <div className="mt-4 space-y-4">
        {section.blocks.map((block) => (
          <Cheatcode101BlockView block={block} key={blockKey(block)} />
        ))}
      </div>
    </section>
  );
}

function blockKey(block: Cheatcode101Block): string {
  if (block.kind === "replayCard") {
    return `replay-${block.replaySlug}`;
  }
  if (block.kind === "bullets") {
    return `bullets-${block.items[0] ?? ""}`;
  }
  return `${block.kind}-${block.text.slice(0, 32)}`;
}

function Cheatcode101BlockView({ block }: { block: Cheatcode101Block }) {
  if (block.kind === "paragraph") {
    return <p className="text-sm text-thread-text-muted leading-7">{block.text}</p>;
  }
  if (block.kind === "bullets") {
    return (
      <ul className="space-y-2 text-sm text-thread-text-muted leading-7">
        {block.items.map((item) => (
          <li className="flex gap-2" key={item}>
            <span aria-hidden="true" className="text-thread-text-muted">
              —
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === "footnote") {
    return (
      <p className="rounded-2xl border border-thread-border bg-thread-surface/50 px-4 py-3 text-thread-text-muted text-xs leading-6">
        {block.text}
      </p>
    );
  }
  return <ReplayCardPlaceholder replaySlug={block.replaySlug} title={block.title} />;
}

function ReplayCardPlaceholder({ replaySlug, title }: { replaySlug: string; title: string }) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-2xl border border-thread-border bg-thread-surface/50 px-4 py-3"
      data-replay-slug={replaySlug}
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-sm text-thread-text-primary">{title}</p>
        <p className="font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.18em]">
          Replay
        </p>
      </div>
      <button
        className="shrink-0 cursor-not-allowed rounded-md border border-thread-border px-3 py-1.5 font-mono text-[10px] text-thread-text-muted uppercase tracking-widest opacity-60"
        disabled
        title="Replays are coming soon"
        type="button"
      >
        Open replay
      </button>
    </div>
  );
}
