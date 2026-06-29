import { Cheatcode101SectionView, Cheatcode101Toc } from "@/components/docs/cheatcode-101-sections";
import { CHEATCODE_101_HERO, CHEATCODE_101_SECTIONS } from "@/content/cheatcode-101";

export default function Cheatcode101Page() {
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto bg-white px-4 pt-8 pb-16 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[740px]">
        <header className="rounded-[22px] border border-[#f1f1f1] bg-[#f8f8f8] p-1">
          <div className="rounded-[18px] bg-white p-6 sm:p-8">
            <p className="mb-4 inline-flex items-center font-mono text-[#a0a0a0] text-[10px] uppercase tracking-[0.24em]">
              cheatcode 101
            </p>
            <h1 className="max-w-3xl font-bold text-[#1b1b1b] text-[30px] leading-[38px] tracking-normal">
              {CHEATCODE_101_HERO}
            </h1>
          </div>
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
