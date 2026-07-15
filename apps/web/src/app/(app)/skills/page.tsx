import { Suspense } from "react";
import { IntegrationSkillsCatalog } from "@/components/skills/integration-skills-catalog";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";

export default function SkillsPage() {
  return (
    <section className="chat-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto bg-background px-2 pt-6 pb-16 text-foreground sm:px-6 md:pt-10 lg:px-10">
      <div className="mx-auto w-full max-w-[740px]">
        <Suspense fallback={<CheatcodeLoader className="min-h-72" label="Loading skills" />}>
          <IntegrationSkillsCatalog />
        </Suspense>
      </div>
    </section>
  );
}
