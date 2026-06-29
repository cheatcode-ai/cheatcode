import { SkillsCatalog } from "@/components/skills/skills-catalog";

export default function SkillsPage() {
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto bg-white px-4 pt-12 pb-16 text-[#1b1b1b] sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-[740px]">
        <h1 className="font-bold text-[30px] leading-9 tracking-[-0.01em]">Skills</h1>
        <SkillsCatalog />
      </div>
    </section>
  );
}
