import { Cheatcode101SectionView, Cheatcode101Toc } from "@/components/docs/cheatcode-101-sections";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { CHEATCODE_101_SECTIONS, CHEATCODE_101_TAGLINE } from "@/content/cheatcode-101";

export default function Cheatcode101Page() {
  return (
    <SettingsPageShell width="narrow">
      <div className="flex">
        <aside className="hidden w-44 shrink-0 pt-6 pr-6 md:pt-2 lg:block">
          <Cheatcode101Toc sections={CHEATCODE_101_SECTIONS} />
        </aside>
        <article className="min-w-0 flex-1 pt-6 pb-8 md:pt-2">
          <header className="mb-16">
            <div className="mb-4 flex items-center gap-2.5 min-[350px]:gap-3">
              <CheatcodeMark
                aria-hidden="true"
                className="size-7 text-primary min-[350px]:size-8"
              />
              <h1 className="font-bold text-[32px] text-foreground leading-9 tracking-[-0.01em] min-[350px]:text-4xl min-[350px]:leading-10">
                Cheatcode 101
              </h1>
            </div>
            <p className="max-w-xl text-fg-secondary text-lg leading-relaxed">
              {CHEATCODE_101_TAGLINE}
            </p>
          </header>
          {CHEATCODE_101_SECTIONS.map((section) => (
            <Cheatcode101SectionView key={section.id} section={section} />
          ))}
        </article>
      </div>
    </SettingsPageShell>
  );
}
