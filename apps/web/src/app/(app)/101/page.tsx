import { Cheatcode101SectionView, Cheatcode101Toc } from "@/components/docs/cheatcode-101-sections";
import { CHEATCODE_101_HERO, CHEATCODE_101_SECTIONS } from "@/content/cheatcode-101";

export default function Cheatcode101Page() {
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto px-4 pt-8 pb-16 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl border border-thread-border bg-thread-surface/65 p-6 shadow-[0_18px_80px_rgba(0,0,0,0.35)] sm:p-8">
          <p className="mb-4 inline-flex items-center font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.24em]">
            cheatcode 101
          </p>
          <h1 className="max-w-3xl font-medium text-2xl text-white tracking-tight sm:text-3xl">
            {CHEATCODE_101_HERO}
          </h1>
        </header>
        <div className="mt-6 grid gap-8 lg:grid-cols-[220px_1fr]">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <Cheatcode101Toc sections={CHEATCODE_101_SECTIONS} />
          </aside>
          <div className="space-y-8">
            {CHEATCODE_101_SECTIONS.map((section) => (
              <Cheatcode101SectionView key={section.id} section={section} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
