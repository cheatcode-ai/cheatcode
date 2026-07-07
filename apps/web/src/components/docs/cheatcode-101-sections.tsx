import type { Cheatcode101Block, Cheatcode101Section } from "@/content/cheatcode-101";

export function Cheatcode101Toc({ sections }: { sections: readonly Cheatcode101Section[] }) {
  return (
    <nav aria-label="cheatcode 101 sections" className="text-sm">
      <p className="mb-3 font-mono text-[#a0a0a0] text-[10px] uppercase tracking-[0.24em]">
        On this page
      </p>
      <ol className="space-y-2">
        {sections.map((section, index) => (
          <li key={section.id}>
            <a
              className="text-[#707070] transition-colors hover:text-[#1b1b1b]"
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
      className="scroll-mt-24 border-[#f1f1f1] border-t pt-8 first:border-t-0 first:pt-0"
      id={section.id}
    >
      <h2 className="flex items-center gap-3 font-semibold text-[#1b1b1b] text-[20px] tracking-normal">
        {section.title}
        {section.draft ? (
          <span className="rounded-full border border-[#f1f1f1] bg-[#fafafa] px-2 py-0.5 font-mono text-[#8a8a8a] text-[9px] uppercase tracking-[0.18em]">
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
  if (block.kind === "bullets") {
    return `bullets-${block.items[0] ?? ""}`;
  }
  return `${block.kind}-${block.text.slice(0, 32)}`;
}

function Cheatcode101BlockView({ block }: { block: Cheatcode101Block }) {
  if (block.kind === "paragraph") {
    return <p className="text-[#707070] text-sm leading-7">{block.text}</p>;
  }
  if (block.kind === "bullets") {
    return (
      <ul className="space-y-2 text-[#707070] text-sm leading-7">
        {block.items.map((item) => (
          <li className="flex gap-2" key={item}>
            <span aria-hidden="true" className="text-[#a0a0a0]">
              -
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === "footnote") {
    return (
      <p className="rounded-[18px] border border-[#f1f1f1] bg-[#fafafa] px-4 py-3 text-[#707070] text-xs leading-6">
        {block.text}
      </p>
    );
  }
  return null;
}
