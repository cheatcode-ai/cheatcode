"use client";

import {
  SKILL_CATEGORIES,
  SKILL_MANIFEST,
  type SkillCategory,
  type SkillManifestEntry,
} from "@cheatcode/skills/manifest";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BookOpen, Code, FileSpreadsheet, type LucideIcon, Sparkles } from "@/components/ui/icons";
import { emitSkillUseClicked } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";

type CatalogTab = "All" | SkillCategory;

const TABS: readonly CatalogTab[] = ["All", ...SKILL_CATEGORIES];

const CATEGORY_ICON: Record<SkillCategory, LucideIcon> = {
  "Builder & Apps": Code,
  "Data & Media": FileSpreadsheet,
  "Research & Docs": BookOpen,
};

export function SkillsCatalog() {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<CatalogTab>("All");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => filterSkills(SKILL_MANIFEST, tab, search), [tab, search]);

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          aria-label="Search skills"
          className="w-full max-w-sm rounded-2xl border border-thread-border bg-black/25 px-4 py-2.5 text-sm text-thread-text-primary outline-none placeholder:text-thread-text-muted"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search skills"
          value={search}
        />
        <div className="flex flex-wrap gap-2">
          {TABS.map((candidate) => (
            <button
              aria-pressed={candidate === tab}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors",
                candidate === tab
                  ? "border-white/25 bg-white/10 text-white"
                  : "border-thread-border text-thread-text-muted hover:text-thread-text-secondary",
              )}
              key={candidate}
              onClick={() => setTab(candidate)}
              type="button"
            >
              <span>{candidate}</span>
              <span className="text-thread-text-muted">
                {countForTab(SKILL_MANIFEST, candidate)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((skill) => (
          <SkillCard getToken={getToken} key={skill.name} skill={skill} />
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="mt-10 text-center font-mono text-[11px] text-thread-text-muted uppercase tracking-[0.2em]">
          No skills match your search
        </p>
      ) : null}
    </div>
  );
}

function SkillCard({
  getToken,
  skill,
}: {
  getToken: () => Promise<null | string>;
  skill: SkillManifestEntry;
}) {
  const Icon = CATEGORY_ICON[skill.category] ?? Sparkles;
  return (
    <article className="group flex flex-col rounded-3xl border border-thread-border bg-thread-surface/50 p-5 transition-colors hover:border-purple-400/35 hover:bg-thread-surface/75">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-thread-border bg-black/25 text-purple-200">
            <Icon aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-mono text-[12px] text-thread-text-primary tracking-[0.18em]">
              {skill.name}
            </h2>
            <p className="mt-1 font-mono text-[9px] text-thread-text-muted uppercase tracking-[0.2em]">
              {skill.category}
            </p>
          </div>
        </div>
      </div>
      <p className="mt-5 min-h-18 text-sm text-thread-text-muted leading-6">{skill.description}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {skill.tags.map((tag) => (
          <span
            className="rounded-full border border-thread-border bg-black/25 px-2.5 py-1 font-mono text-[9px] text-thread-text-muted uppercase tracking-[0.16em]"
            key={tag}
          >
            {tag}
          </span>
        ))}
      </div>
      <Link
        className="mt-5 inline-flex h-9 w-fit items-center justify-center rounded-full bg-white px-4 font-medium text-black text-xs transition-colors hover:bg-zinc-200"
        href={`/?skill=${encodeURIComponent(skill.name)}`}
        onClick={() => emitSkillUseClicked(getToken)}
      >
        Use
      </Link>
    </article>
  );
}

function filterSkills(
  skills: readonly SkillManifestEntry[],
  tab: CatalogTab,
  search: string,
): SkillManifestEntry[] {
  const needle = search.trim().toLowerCase();
  return skills.filter((skill) => {
    if (tab !== "All" && skill.category !== tab) {
      return false;
    }
    if (needle.length === 0) {
      return true;
    }
    return (
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle) ||
      skill.tags.some((tag) => tag.toLowerCase().includes(needle))
    );
  });
}

function countForTab(skills: readonly SkillManifestEntry[], tab: CatalogTab): number {
  return tab === "All" ? skills.length : skills.filter((skill) => skill.category === tab).length;
}
