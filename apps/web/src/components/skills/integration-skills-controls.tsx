"use client";

import type { ToolkitCategory } from "@cheatcode/types";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MoreVertical, Search } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

const ALL_CATEGORY = "all";
const PRIMARY_CATEGORY_SLUGS = ["developer-tools", "team-collaboration", "documents"] as const;
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  "developer-tools": "Developer Tools & DevOps",
  documents: "Document & File Management",
  "team-collaboration": "Collaboration & Communication",
};

export function SkillsHeader({
  onSearch,
  search,
}: {
  onSearch: (value: string) => void;
  search: string;
}) {
  return (
    <>
      <h1 className="hidden font-bold text-3xl text-foreground leading-9 tracking-[-0.01em] md:block">
        Skills
      </h1>
      <div className="flex min-w-0 items-center justify-between gap-4">
        <SkillsSearch onSearch={onSearch} search={search} />
        <Link
          className="relative hidden h-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-foreground px-4 py-2 font-medium text-background text-sm shadow-[inset_0_1px_0_rgba(255,255,255,.15),0_1px_3px_rgba(0,0,0,.2)] transition-transform duration-200 ease-out before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/20 before:opacity-50 before:transition-opacity hover:before:opacity-0 active:scale-[.99] md:inline-flex"
          href="/?mode=skill-creator"
        >
          Create skill
        </Link>
      </div>
    </>
  );
}

function SkillsSearch({ onSearch, search }: { onSearch: (value: string) => void; search: string }) {
  return (
    <label className="relative block min-w-0 flex-1 md:max-w-[362px]" htmlFor="skills-search">
      <span className="sr-only">Search skills</span>
      <Search
        aria-hidden="true"
        className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-fg-secondary"
      />
      <input
        className="h-8 w-full rounded-full border-0 bg-secondary py-1 pr-3 pl-10 font-medium text-foreground text-sm outline-none ring-2 ring-border ring-offset-2 ring-offset-background transition-colors duration-150 placeholder:text-placeholder dark:bg-input/30"
        id="skills-search"
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search by name"
        value={search}
      />
    </label>
  );
}

export function CategoryTabs({
  categories,
  onSelect,
  selected,
}: {
  categories: readonly ToolkitCategory[];
  onSelect: (slug: string) => void;
  selected: string;
}) {
  const menu = useCategoryMenu();
  if (categories.length === 0) {
    return null;
  }
  const { overflow, primarySlugs, tabs } = categoryGroups(categories);
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <PrimaryCategoryTabs onSelect={onSelect} selected={selected} tabs={tabs} />
      {overflow.length > 0 ? (
        <MoreCategoryMenu
          menu={menu}
          onSelect={onSelect}
          overflow={overflow}
          primarySlugs={primarySlugs}
          selected={selected}
        />
      ) : null}
    </div>
  );
}

function useCategoryMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);
  return { close: () => setIsOpen(false), isOpen, ref, toggle: () => setIsOpen((value) => !value) };
}

function categoryGroups(categories: readonly ToolkitCategory[]) {
  const primary = PRIMARY_CATEGORY_SLUGS.map((slug) =>
    categories.find((category) => category.slug === slug),
  ).filter((category): category is ToolkitCategory => category !== undefined);
  const primarySlugs = new Set(primary.map((category) => category.slug));
  return {
    overflow: categories.filter((category) => !primarySlugs.has(category.slug)),
    primarySlugs,
    tabs: [{ name: "All", slug: ALL_CATEGORY }, ...primary],
  };
}

function PrimaryCategoryTabs({
  onSelect,
  selected,
  tabs,
}: {
  onSelect: (slug: string) => void;
  selected: string;
  tabs: readonly { name: string; slug: string }[];
}) {
  return (
    <div className="chat-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain">
      {tabs.map((tab) => (
        <CategoryTab key={tab.slug} onSelect={onSelect} selected={selected} tab={tab} />
      ))}
    </div>
  );
}

function CategoryTab({
  onSelect,
  selected,
  tab,
}: {
  onSelect: (slug: string) => void;
  selected: string;
  tab: { name: string; slug: string };
}) {
  const isActive = tab.slug === selected;
  return (
    <button
      aria-pressed={isActive}
      className={cn(
        "h-8 max-w-[220px] shrink-0 select-none rounded-full border px-3 py-[5px] font-medium text-sm leading-5 transition-colors duration-150",
        isActive
          ? "border-border bg-background text-foreground/80"
          : "border-transparent bg-background text-placeholder hover:text-foreground",
      )}
      onClick={() => onSelect(tab.slug)}
      type="button"
    >
      <span className="block truncate">{CATEGORY_LABELS[tab.slug] ?? tab.name}</span>
    </button>
  );
}

function MoreCategoryMenu({
  menu,
  onSelect,
  overflow,
  primarySlugs,
  selected,
}: {
  menu: ReturnType<typeof useCategoryMenu>;
  onSelect: (slug: string) => void;
  overflow: readonly ToolkitCategory[];
  primarySlugs: ReadonlySet<string>;
  selected: string;
}) {
  return (
    <div className="relative shrink-0" ref={menu.ref}>
      <button
        aria-expanded={menu.isOpen}
        aria-label="More skill categories"
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-placeholder transition-colors duration-150 hover:bg-secondary hover:text-foreground",
          !primarySlugs.has(selected) && selected !== ALL_CATEGORY
            ? "bg-secondary text-foreground"
            : null,
        )}
        onClick={menu.toggle}
        type="button"
      >
        <MoreVertical aria-hidden="true" className="size-4" />
      </button>
      {menu.isOpen ? (
        <CategoryOverflowList
          close={menu.close}
          onSelect={onSelect}
          rows={overflow}
          selected={selected}
        />
      ) : null}
    </div>
  );
}

function CategoryOverflowList({
  close,
  onSelect,
  rows,
  selected,
}: {
  close: () => void;
  onSelect: (slug: string) => void;
  rows: readonly ToolkitCategory[];
  selected: string;
}) {
  return (
    <div className="absolute top-10 right-0 z-20 grid max-h-72 w-64 gap-0.5 overflow-y-auto rounded-2xl border-2 border-border bg-background p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.1)]">
      {rows.map((category) => (
        <button
          aria-pressed={selected === category.slug}
          className={cn(
            "min-h-9 rounded-xl px-3 text-left font-medium text-sm transition-colors duration-150 hover:bg-secondary",
            selected === category.slug ? "bg-secondary text-foreground" : "text-placeholder",
          )}
          key={category.slug}
          onClick={() => {
            onSelect(category.slug);
            close();
          }}
          type="button"
        >
          {category.name}
        </button>
      ))}
    </div>
  );
}
