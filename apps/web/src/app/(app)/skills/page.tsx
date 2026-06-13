import { SkillsCatalog } from "@/components/skills/skills-catalog";
import { Sparkles } from "@/components/ui/icons";

export default function SkillsPage() {
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto px-4 pt-8 pb-12 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
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
            request calls for it. Press <span className="font-semibold text-white">Use</span> to
            start a task with a skill preselected.
          </p>
        </header>

        <SkillsCatalog />
      </div>
    </section>
  );
}
