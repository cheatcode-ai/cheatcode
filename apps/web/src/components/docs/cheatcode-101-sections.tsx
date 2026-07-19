"use client";

import { ArrowUpRight, ChevronDown, Play } from "@cheatcode/ui";
import { useEffect, useState } from "react";
import { PromptLaunchButton } from "@/components/navigation/prompt-launch-button";
import type {
  Cheatcode101Block,
  Cheatcode101Faq,
  Cheatcode101Section,
} from "@/content/cheatcode-101";
import { cn } from "@/lib/ui/cn";

const SECTION_ACTIVATION_OFFSET = 96;
const SCROLL_END_TOLERANCE = 2;

export function Cheatcode101Toc({ sections }: { sections: readonly Cheatcode101Section[] }) {
  const [activeId, setActiveId] = useActiveSection(sections);
  return (
    <nav aria-label="Cheatcode 101 sections" className="sticky top-12 flex flex-col gap-0.5">
      {sections.map((section) => (
        <TocLink
          active={activeId === section.id}
          key={section.id}
          onActivate={setActiveId}
          section={section}
        />
      ))}
    </nav>
  );
}

function useActiveSection(sections: readonly Cheatcode101Section[]) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    const sectionElements = sections
      .map((section) => document.getElementById(section.id))
      .filter((section): section is HTMLElement => section !== null);
    const scrollRoot = sectionElements[0]?.closest(".chat-scrollbar");
    if (!(scrollRoot instanceof HTMLElement) || sectionElements.length === 0) {
      return;
    }

    const updateActiveSection = () => {
      const nextActiveId = getActiveSectionId(scrollRoot, sectionElements);
      if (nextActiveId) {
        setActiveId(nextActiveId);
      }
    };

    updateActiveSection();
    scrollRoot.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      scrollRoot.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [sections]);
  return [activeId, setActiveId] as const;
}

function TocLink({
  active,
  onActivate,
  section,
}: {
  active: boolean;
  onActivate: (id: string) => void;
  section: Cheatcode101Section;
}) {
  return (
    <a
      aria-current={active ? "location" : undefined}
      className={cn(
        "rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-fg-secondary hover:bg-bg-secondary hover:text-foreground",
      )}
      href={`#${section.id}`}
      onClick={() => onActivate(section.id)}
    >
      {section.title}
    </a>
  );
}

function getActiveSectionId(scrollRoot: HTMLElement, sections: readonly HTMLElement[]): string {
  const finalSection = sections.at(-1);
  const isAtBottom =
    scrollRoot.scrollTop + scrollRoot.clientHeight >=
    scrollRoot.scrollHeight - SCROLL_END_TOLERANCE;
  if (isAtBottom && finalSection) {
    return finalSection.id;
  }

  const activationTop = scrollRoot.getBoundingClientRect().top + SECTION_ACTIVATION_OFFSET;
  let activeSection = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top > activationTop) {
      break;
    }
    activeSection = section;
  }
  return activeSection?.id ?? "";
}

export function Cheatcode101SectionView({ section }: { section: Cheatcode101Section }) {
  return (
    <section className="mb-14 scroll-mt-20" id={section.id}>
      <h2 className="mb-4 font-bold text-2xl text-foreground leading-8">{section.title}</h2>
      <div className="flex flex-col gap-4 text-fg-secondary text-sm leading-relaxed">
        {section.blocks.map((block) => (
          <Cheatcode101BlockView block={block} key={blockKey(block)} />
        ))}
      </div>
    </section>
  );
}

function blockKey(block: Cheatcode101Block): string {
  if (block.kind === "example") {
    return `example-${block.label}`;
  }
  if (block.kind === "faqs") {
    return `faqs-${block.items[0]?.question ?? "empty"}`;
  }
  return `paragraph-${block.text.slice(0, 40)}`;
}

function Cheatcode101BlockView({ block }: { block: Cheatcode101Block }) {
  if (block.kind === "paragraph") {
    return <p>{block.text}</p>;
  }
  if (block.kind === "example") {
    return <Cheatcode101Example block={block} />;
  }
  return <Cheatcode101Faqs items={block.items} />;
}

function Cheatcode101Example({
  block,
}: {
  block: Extract<Cheatcode101Block, { kind: "example" }>;
}) {
  return (
    <PromptLaunchButton
      className="group flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-secondary/55 px-4 py-3 transition-colors hover:border-border hover:bg-secondary"
      prompt={block.prompt}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-fg-secondary ring-1 ring-border/70">
          <Play aria-hidden="true" className="size-4 fill-current" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground text-sm">{block.label}</span>
          <span className="block text-[13px] text-placeholder leading-[19.5px]">
            Start in a new chat
          </span>
        </span>
      </span>
      <ArrowUpRight
        aria-hidden="true"
        className="size-4 shrink-0 text-placeholder transition-[color,transform] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground motion-reduce:transition-none"
      />
    </PromptLaunchButton>
  );
}

function Cheatcode101Faqs({ items }: { items: readonly Cheatcode101Faq[] }) {
  const [openQuestion, setOpenQuestion] = useState<null | string>(null);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-secondary/45 p-2">
      {items.map((item) => (
        <FaqItem
          item={item}
          key={item.question}
          onToggle={() =>
            setOpenQuestion((current) => (current === item.question ? null : item.question))
          }
          open={openQuestion === item.question}
        />
      ))}
    </div>
  );
}

function FaqItem({
  item,
  onToggle,
  open,
}: {
  item: Cheatcode101Faq;
  onToggle: () => void;
  open: boolean;
}) {
  const contentId = `cheatcode-101-${slug(item.question)}`;
  const triggerId = `${contentId}-trigger`;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/70 bg-background/70 px-4",
        open && "bg-background",
      )}
    >
      <FaqToggle
        contentId={contentId}
        onToggle={onToggle}
        open={open}
        question={item.question}
        triggerId={triggerId}
      />
      <FaqAnswer answer={item.answer} contentId={contentId} open={open} triggerId={triggerId} />
    </div>
  );
}

function FaqToggle({
  contentId,
  onToggle,
  open,
  question,
  triggerId,
}: {
  contentId: string;
  onToggle: () => void;
  open: boolean;
  question: string;
  triggerId: string;
}) {
  return (
    <h3 className="flex">
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="flex flex-1 cursor-pointer items-start justify-between gap-4 rounded-md py-4 text-left font-medium text-base text-foreground"
        id={triggerId}
        onClick={onToggle}
        type="button"
      >
        {question}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0 text-placeholder transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
    </h3>
  );
}

function FaqAnswer({
  answer,
  contentId,
  open,
  triggerId,
}: {
  answer: string;
  contentId: string;
  open: boolean;
  triggerId: string;
}) {
  return (
    <section
      aria-labelledby={triggerId}
      aria-hidden={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      id={contentId}
    >
      <div className="min-h-0 overflow-hidden">
        <p className="pr-8 pb-4 text-fg-secondary text-sm leading-relaxed">{answer}</p>
      </div>
    </section>
  );
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
