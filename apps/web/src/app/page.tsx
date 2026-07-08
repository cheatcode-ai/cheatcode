import { Suspense } from "react";
import { HomeComposerFromSearchParams } from "@/components/home/home-composer-from-search-params";
import { HomeGreeting } from "@/components/home/home-greeting";
import { HomeHeadline } from "@/components/home/home-headline";
import { HomeSessionChrome } from "@/components/home/home-session-chrome";
import { HomeSidebarOffset } from "@/components/home/home-sidebar-offset";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";

export default function HomePage() {
  return (
    <div className="relative min-h-screen bg-white text-[#1b1b1b] transition-[padding] duration-200 md:pl-[var(--cheatcode-sidebar-offset,16rem)]">
      <HomeSidebarOffset />
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
          <HomeHeadline />
          <HomeComposerFromSearchParams />
        </section>
      </main>
    </div>
  );
}
