import { SKILLS as BUNDLED_SKILLS, type BundledSkill } from "@cheatcode/skills";
import { BookOpen, Code, FileSpreadsheet, Sparkles } from "@/components/ui/icons";

const SKILL_META = {
  "competitor-brief": { category: "Intel", tools: ["Company search", "Pricing scrape", "Brief"] },
  "csv-analyst": { category: "Data", tools: ["Arquero", "Python", "Charts"] },
  "deep-research": { category: "Research", tools: ["25-way fanout", "Citations", "Report"] },
  "landing-page": { category: "Builder", tools: ["Next.js", "Copy", "Preview"] },
  "mobile-app": { category: "Builder", tools: ["Responsive", "Mobile UI", "Preview"] },
  "pitch-deck": { category: "Docs", tools: ["Deck", "Research", "PPTX"] },
  "slide-from-prd": { category: "Docs", tools: ["Slides", "Outline", "QA"] },
  "social-post-pack": { category: "Content", tools: ["LinkedIn", "X", "Launch"] },
} as const satisfies Record<string, { category: string; tools: readonly string[] }>;

export default function SkillsPage() {
  const skills = BUNDLED_SKILLS.map(catalogSkill).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto px-4 pt-8 pb-12 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <header className="rounded-3xl border border-thread-border bg-thread-surface/65 p-6 shadow-[0_18px_80px_rgba(0,0,0,0.35)] sm:p-8">
            <div className="mb-5 inline-flex items-center gap-2 border border-thread-border bg-black/30 px-3 py-1.5 font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.24em]">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              Curated V1 catalog
            </div>
            <h1 className="max-w-3xl font-mono text-2xl text-white tracking-tight sm:text-3xl">
              Eight bundled skills, loaded at build time
            </h1>
            <p className="mt-4 max-w-3xl text-sm text-thread-text-muted leading-7">
              Skills are multi-step operating procedures for high-value work. They stay bundled into
              the Worker at build time, then the agent loads only the matching skill body when the
              request calls for it.
            </p>
          </header>

          <aside className="rounded-3xl border border-thread-border bg-thread-surface/65 p-6 shadow-[0_18px_80px_rgba(0,0,0,0.28)]">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-200">
              <Sparkles aria-hidden="true" className="h-5 w-5" />
            </div>
            <h2 className="mt-5 font-mono text-sm text-white uppercase tracking-[0.2em]">
              Runtime catalog
            </h2>
            <p className="mt-3 text-sm text-thread-text-muted leading-6">
              Skills are bundled into the Worker at build time. External publishing and registry
              prep are intentionally outside V2.
            </p>
            <div className="mt-5 rounded-2xl border border-thread-border bg-black/25 px-4 py-3 font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.18em]">
              Build-time only
            </div>
          </aside>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {skills.map((skill) => (
            <article
              className="group rounded-3xl border border-thread-border bg-thread-surface/50 p-5 transition-colors hover:border-purple-400/35 hover:bg-thread-surface/75"
              key={skill.name}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <SkillIcon category={skill.category} />
                  <div className="min-w-0">
                    <h2 className="truncate font-mono text-[12px] text-thread-text-primary tracking-[0.18em]">
                      {skill.name}
                    </h2>
                    <p className="mt-1 font-mono text-[9px] text-thread-text-muted uppercase tracking-[0.2em]">
                      {skill.category}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 font-mono text-[9px] text-emerald-300 uppercase tracking-[0.18em]">
                  Bundled
                </span>
              </div>
              <p className="mt-5 min-h-18 text-sm text-thread-text-muted leading-6">
                {skill.description}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {skill.tools.map((tool) => (
                  <span
                    className="rounded-full border border-thread-border bg-black/25 px-2.5 py-1 font-mono text-[9px] text-thread-text-muted uppercase tracking-[0.16em]"
                    key={tool}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function catalogSkill(skill: BundledSkill) {
  const meta = SKILL_META[skill.name as keyof typeof SKILL_META] ?? {
    category: "Skill",
    tools: ["Bundled", "References", "Worker"],
  };
  return {
    category: meta.category,
    description: skill.description,
    name: skill.name,
    tools: meta.tools,
  };
}

function SkillIcon({ category }: { category: string }) {
  const Icon =
    category === "Research"
      ? BookOpen
      : category === "Data"
        ? FileSpreadsheet
        : category === "Builder"
          ? Code
          : Sparkles;
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-thread-border bg-black/25 text-purple-200 transition-colors group-hover:border-purple-400/30">
      <Icon aria-hidden="true" className="h-5 w-5" />
    </div>
  );
}
