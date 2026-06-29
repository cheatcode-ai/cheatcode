"use client";

import {
  SKILL_CATEGORIES,
  SKILL_MANIFEST,
  type SkillCategory,
  type SkillManifestEntry,
} from "@cheatcode/skills/manifest";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import {
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ChevronDown,
  FileText,
  LayoutTemplate,
  Megaphone,
  Presentation,
  Search,
  Smartphone,
  Telescope,
} from "@/components/ui/icons";
import { emitSkillUseClicked } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";

type CatalogTab = "All" | SkillCategory;

const TABS: readonly CatalogTab[] = ["All", ...SKILL_CATEGORIES];

type SkillIconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "false" | "true";
}>;

type SkillVisual = {
  icon: SkillIconComponent;
  iconClassName: string;
};

const DEFAULT_SKILL_VISUAL: SkillVisual = {
  icon: CheatcodeMark,
  iconClassName: "bg-[#f7f7f7] text-[#a9842e]",
};

const SKILL_VISUALS: Partial<Record<string, SkillVisual>> = {
  "competitor-brief": {
    icon: BriefcaseBusiness,
    iconClassName: "bg-[#f7f7f7] text-[#86641d]",
  },
  "csv-analyst": {
    icon: ChartNoAxesCombined,
    iconClassName: "bg-[#f6f8f4] text-[#4d7a45]",
  },
  "deep-research": {
    icon: Telescope,
    iconClassName: "bg-[#f7f7f7] text-[#4f6f8f]",
  },
  "landing-page": {
    icon: LayoutTemplate,
    iconClassName: "bg-[#f7f7f7] text-[#7a5a1f]",
  },
  "mobile-app": {
    icon: Smartphone,
    iconClassName: "bg-[#f5f7f8] text-[#4f6f7d]",
  },
  "pitch-deck": {
    icon: Presentation,
    iconClassName: "bg-[#f7f7f7] text-[#927126]",
  },
  "slide-from-prd": {
    icon: FileText,
    iconClassName: "bg-[#f7f7f7] text-[#756531]",
  },
  "social-post-pack": {
    icon: Megaphone,
    iconClassName: "bg-[#f8f6f4] text-[#94602d]",
  },
};

export function SkillsCatalog() {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<CatalogTab>("All");
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => filterSkills(SKILL_MANIFEST, tab, search), [tab, search]);
  const desktopColumns = useMemo(() => splitSkillColumns(filtered), [filtered]);

  return (
    <div className="mt-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block min-w-0 sm:w-[362px]" htmlFor="skills-search">
          <span className="sr-only">Search skills</span>
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-[#707070]"
          />
          <input
            className="h-8 w-full rounded-full border-0 bg-[#f7f7f7] pr-3 pl-10 font-medium text-[#1b1b1b] text-[14px] shadow-[0_0_0_2px_#fff,0_0_0_4px_#f7f7f7] outline-none placeholder:text-[#a0a0a0] focus:shadow-[0_0_0_2px_#fff,0_0_0_4px_#dedede]"
            id="skills-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name"
            value={search}
          />
        </label>
        <button
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-[#1b1b1b] px-5 font-medium text-[14px] text-white shadow-[0_0_1px_rgba(0,0,0,0.24)] disabled:opacity-100"
          disabled
          type="button"
        >
          Create skill
        </button>
      </div>
      <div className="scrollbar-hide mt-8 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((candidate) => (
          <button
            aria-pressed={candidate === tab}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1 rounded-full px-3 font-medium text-[14px] transition-colors",
              candidate === tab
                ? "border border-[#f1f1f1] bg-white text-[#1b1b1b]"
                : "text-[#8a8a8a] hover:text-[#1b1b1b]",
            )}
            key={candidate}
            onClick={() => setTab(candidate)}
            type="button"
          >
            <span>{candidate}</span>
          </button>
        ))}
      </div>

      <div className="mt-9 flex flex-col gap-4 md:hidden">
        {filtered.map((skill) => (
          <SkillCard getToken={getToken} instanceId="mobile" key={skill.name} skill={skill} />
        ))}
      </div>
      <div className="mt-9 hidden gap-4 md:grid md:grid-cols-2">
        {desktopColumns.map((column) => (
          <div className="flex min-w-0 flex-col gap-4" key={column.id}>
            {column.skills.map((skill) => (
              <SkillCard
                getToken={getToken}
                instanceId={`desktop-${column.id}`}
                key={skill.name}
                skill={skill}
              />
            ))}
          </div>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="mt-10 text-center text-[#8a8a8a] text-[14px]">No skills match your search</p>
      ) : null}
    </div>
  );
}

function SkillCard({
  getToken,
  instanceId,
  skill,
}: {
  getToken: () => Promise<null | string>;
  instanceId: string;
  skill: SkillManifestEntry;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const visual = SKILL_VISUALS[skill.name] ?? DEFAULT_SKILL_VISUAL;
  const Icon = visual.icon;
  const descriptionId = `skill-${instanceId}-${skill.name}-description`;
  const titleId = `skill-${instanceId}-${skill.name}-title`;
  const toggleExpanded = () => setIsExpanded((current) => !current);

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "group min-h-[92px] self-start rounded-[23px] border-2 border-[#f7f7f7] bg-white p-0.5 text-left transition-[border-color,box-shadow] duration-200 ease-out hover:border-[#ececec]",
        isExpanded ? "border-[#ececec] shadow-[0_10px_28px_rgba(0,0,0,0.04)]" : null,
      )}
    >
      <div className="flex h-11 items-center gap-3 px-3.5 py-2.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-[14px]",
            visual.iconClassName,
          )}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <h2
          className="min-w-0 flex-1 truncate font-medium text-[#1b1b1b] text-[14px] leading-5"
          id={titleId}
        >
          {skill.name}
        </h2>
        <button
          aria-controls={descriptionId}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Collapse ${skill.name}` : `Show ${skill.name} details`}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#8a8a8a] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/15"
          onClick={toggleExpanded}
          type="button"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-4 w-4 transition-transform duration-200 ease-out",
              isExpanded ? "rotate-180" : null,
            )}
          />
        </button>
      </div>
      <div className="overflow-hidden rounded-[20px] bg-[#f7f7f7] transition-[background-color] duration-200">
        <div className="flex min-h-10 items-start gap-3 px-4">
          <button
            aria-controls={descriptionId}
            aria-expanded={isExpanded}
            className="min-w-0 flex-1 py-2 text-left focus-visible:outline-none"
            onClick={toggleExpanded}
            type="button"
          >
            <p
              className={cn(
                "min-w-0 font-medium text-[#707070] text-[13px] leading-[19.5px] transition-colors",
                isExpanded ? null : "line-clamp-1",
              )}
              id={descriptionId}
            >
              {skill.description}
            </p>
          </button>
          <Link
            className="mt-2 shrink-0 font-medium text-[#707070] text-[13px] leading-[19.5px] transition-colors hover:text-[#1b1b1b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b1b1b]/15"
            href={`/?skill=${encodeURIComponent(skill.name)}`}
            onClick={() => emitSkillUseClicked(getToken)}
          >
            Use
          </Link>
        </div>
      </div>
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
      skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)
    );
  });
}

function splitSkillColumns(skills: readonly SkillManifestEntry[]) {
  const columns = [
    { id: "left", skills: [] as SkillManifestEntry[] },
    { id: "right", skills: [] as SkillManifestEntry[] },
  ] as const;
  skills.forEach((skill, index) => {
    columns[index % columns.length]?.skills.push(skill);
  });
  return columns;
}
