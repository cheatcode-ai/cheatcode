import { Suspense } from "react";
import { FeaturedReplays } from "@/components/home/featured-replays";
import { HomeComposerFromSearchParams } from "@/components/home/home-composer-from-search-params";
import { HomeGreeting } from "@/components/home/home-greeting";
import { HomeSessionChrome } from "@/components/home/home-session-chrome";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";

export default function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="relative min-h-screen bg-white text-[#1b1b1b] transition-[padding] duration-200 md:pl-[var(--cheatcode-sidebar-offset,16rem)]">
      <Suspense fallback={null}>
        <AppSidebar variant="full" />
      </Suspense>
      <HomeSessionChrome />
      <main className="cheatcode-home-main relative min-h-screen px-6 pt-[80px] pb-44">
        <section className="cheatcode-home-center mx-auto flex w-full max-w-[740px] flex-col items-center px-4 pb-10">
          <CheatcodeMark aria-hidden="true" className="h-[42px] w-[42px] text-[#f8af2c]" />
          <Suspense fallback={<div className="mb-2 h-4 w-40 rounded-full bg-[#f7f7f7]" />}>
            <HomeGreeting />
          </Suspense>
          <h1 className="mt-1 text-center font-bold text-[24px] leading-8 tracking-[-0.01em]">
            cheatcode ready to build
          </h1>
          <HomeComposerFromSearchParams />
          <Suspense fallback={<div className="mt-6 h-32 w-full rounded-2xl bg-[#f7f7f7]" />}>
            <HomeFeaturedSlot searchParams={searchParams} />
          </Suspense>
        </section>
      </main>
    </div>
  );
}

/**
 * Renders "Watch replays" — except in Skill Creator mode, where the composer shows the
 * "Create skills" panel in its place (bud parity). Reads `searchParams` inside a Suspense
 * boundary so the rest of the home route still prerenders.
 */
async function HomeFeaturedSlot({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await searchParams)["mode"] === "skill-creator") {
    return null;
  }
  return <FeaturedReplays />;
}
