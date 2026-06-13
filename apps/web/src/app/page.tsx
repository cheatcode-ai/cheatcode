import { SKILL_MANIFEST } from "@cheatcode/skills/manifest";
import { SignInButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import Image from "next/image";
import Link from "next/link";
import { Suspense, type SVGProps } from "react";
import { FeaturedReplays } from "@/components/home/featured-replays";
import { HomeComposer } from "@/components/home/home-composer";
import { HomeGreeting } from "@/components/home/home-greeting";
import { Menu, Star, User, Zap } from "@/components/ui/icons";

type NavUser = {
  displayName: string;
  imageUrl: string;
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialSkill = validInitialSkill(params["skill"]);
  return (
    <div className="gradient-home-bg relative min-h-screen w-full overflow-hidden text-white">
      <Suspense fallback={<HomeHeaderContent user={null} />}>
        <HomeHeader />
      </Suspense>
      <main className="flex min-h-screen w-full flex-col items-center justify-center pt-16">
        <section className="relative w-full overflow-hidden">
          <div className="relative flex w-full flex-col items-center px-6">
            <div className="relative z-10 mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-10 pt-16">
              <div className="flex flex-col items-center justify-center gap-5 pt-8">
                <Suspense fallback={null}>
                  <HomeGreeting />
                </Suspense>
                <h1 className="text-balance text-center font-medium text-3xl tracking-tight md:text-4xl lg:text-5xl xl:text-6xl">
                  what will you build today?
                </h1>
              </div>
              <HomeComposer initialSkill={initialSkill} />
              <Suspense fallback={null}>
                <FeaturedReplays />
              </Suspense>
            </div>
          </div>
          <div className="mx-auto mb-16 max-w-4xl sm:mt-52" />
        </section>
      </main>
    </div>
  );
}

function validInitialSkill(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && SKILL_MANIFEST.some((skill) => skill.name === candidate)) {
    return candidate;
  }
  return undefined;
}

async function HomeHeader() {
  const user = await currentUser();
  const navUser = user
    ? {
        displayName:
          user.fullName ??
          user.firstName ??
          user.primaryEmailAddress?.emailAddress ??
          "Cheatcode user",
        imageUrl: user.imageUrl,
      }
    : null;

  return <HomeHeaderContent user={navUser} />;
}

function HomeHeaderContent({ user }: { user: NavUser | null }) {
  return (
    <header className="relative z-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-[56px] items-center justify-between">
          {user ? (
            <Link
              className="flex items-center gap-3 transition-opacity hover:opacity-80"
              href="/projects"
              title="Open projects"
            >
              <Menu aria-hidden="true" className="h-5 w-5 text-white" />
              <Image
                alt="Cheatcode Logo"
                className="h-auto w-[98px]"
                height={39}
                src="/logo-white.png"
                style={{ height: "auto" }}
                width={173}
              />
            </Link>
          ) : (
            <Link className="flex items-center gap-3 transition-opacity hover:opacity-80" href="/">
              <Image
                alt="Cheatcode Logo"
                className="h-auto w-[98px]"
                height={39}
                src="/logo-white.png"
                style={{ height: "auto" }}
                width={173}
              />
            </Link>
          )}
          <HomeNavActions user={user} />
        </div>
      </div>
    </header>
  );
}

function HomeNavActions({ user }: { user: NavUser | null }) {
  return (
    <div className="flex shrink-0 flex-row items-center gap-1 md:gap-3">
      <div className="hidden items-center gap-x-2 md:flex">
        <Link href="https://github.com/cheatcode-ai/cheatcode" rel="noreferrer" target="_blank">
          <span className="flex h-9 w-auto items-center gap-1.5 px-2 text-white transition-colors hover:bg-white/10">
            <GithubIcon className="h-4 w-4" />
            <Star aria-hidden="true" className="h-3 w-3 fill-current" />
            <span className="font-medium text-xs tabular-nums">13</span>
            <span className="sr-only">GitHub Stars</span>
          </span>
        </Link>
        <Link href="https://www.linkedin.com/company/trycheatcode" rel="noreferrer" target="_blank">
          <span className="flex h-9 w-9 items-center justify-center text-white transition-colors hover:bg-white/10">
            <LinkedInIcon className="h-4 w-4" />
            <span className="sr-only">LinkedIn</span>
          </span>
        </Link>
        <Link href="https://x.com/trycheatcode" rel="noreferrer" target="_blank">
          <span className="flex h-9 w-9 items-center justify-center text-white transition-colors hover:bg-white/10">
            <XIcon className="h-4 w-4" />
            <span className="sr-only">X</span>
          </span>
        </Link>
        <Link href="https://discord.gg/cheatcode" rel="noreferrer" target="_blank">
          <span className="flex h-9 w-9 items-center justify-center text-white transition-colors hover:bg-white/10">
            <DiscordIcon className="h-4 w-4" />
            <span className="sr-only">Discord</span>
          </span>
        </Link>
      </div>
      {user ? (
        <div className="hidden items-center space-x-2 md:flex">
          <Link
            className="flex h-8 items-center justify-center gap-2 rounded-full border border-white/10 bg-black px-4 font-mono text-[10px] text-white uppercase tracking-wider shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-colors hover:bg-zinc-950"
            href="/settings/integrations"
          >
            <Zap aria-hidden="true" className="h-3.5 w-3.5" />
            Integrations
          </Link>
          <Link
            aria-label={user.displayName}
            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_rgba(0,0,0,0.25)]"
            href="/settings/account"
          >
            {user.imageUrl ? (
              <Image
                alt=""
                className="h-full w-full object-cover"
                height={32}
                src={user.imageUrl}
                unoptimized
                width={32}
              />
            ) : (
              <User aria-hidden="true" className="h-5 w-5" />
            )}
          </Link>
        </div>
      ) : (
        <div className="hidden items-center space-x-2 md:flex">
          <SignInButton>
            <button
              className="flex h-8 items-center justify-center rounded-full px-4 font-normal text-primary text-sm tracking-wide transition-colors hover:text-primary/80"
              type="button"
            >
              Login
            </button>
          </SignInButton>
          <SignInButton mode="modal">
            <button
              className="flex h-8 w-fit items-center justify-center rounded-full border border-white/[0.12] bg-secondary px-4 font-normal text-primary-foreground text-sm tracking-wide shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_3px_3px_-1.5px_rgba(16,24,40,0.06),0_1px_1px_rgba(16,24,40,0.08)] transition-all hover:bg-secondary/80 dark:text-secondary-foreground"
              type="button"
            >
              Sign up
            </button>
          </SignInButton>
        </div>
      )}
    </div>
  );
}

function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LinkedInIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 50 50" {...props}>
      <path d="M9 4c-2.75 0-5 2.25-5 5v32c0 2.75 2.25 5 5 5h32c2.75 0 5-2.25 5-5V9c0-2.75-2.25-5-5-5H9zm0 2h32c1.668 0 3 1.332 3 3v32c0 1.668-1.332 3-3 3H9c-1.668 0-3-1.332-3-3V9c0-1.668 1.332-3 3-3zm5 5.012c-1.095 0-2.081.327-2.811.941C10.459 12.567 10 13.484 10 14.467c0 1.867 1.62 3.322 3.68 3.466.01 0 .315.053.32.053 2.273 0 3.988-1.593 3.988-3.522 0-1.953-1.694-3.455-3.884-3.455zM11 19a1 1 0 0 0-1 1v19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V20a1 1 0 0 0-1-1h-6zm9 0a1 1 0 0 0-1 1v19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-10c0-.83.226-1.655.625-2.195.399-.54.902-.864 1.858-.847.985.017 1.507.355 1.901.885.394.53.615 1.325.615 2.158v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V28.262c0-2.962-.877-5.308-2.381-6.895C36.116 19.78 34.025 19 31.813 19c-2.102 0-3.701.705-4.813 1.424V20a1 1 0 0 0-1-1h-6z" />
    </svg>
  );
}

function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 30 30" {...props}>
      <path d="M26.37 26l-8.795-12.822.015.012L25.52 4h-2.65l-6.46 7.48L11.28 4H4.33l8.211 11.971-.001-.001L3.88 26h2.65l7.182-8.322L19.42 26h6.95zM10.23 6l12.34 18h-2.1L8.12 6h2.11z" />
    </svg>
  );
}

function DiscordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M20.317 4.369a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.211.375-.444.864-.608 1.249-1.844-.276-3.68-.276-5.486 0-.164-.401-.418-.874-.629-1.249a.077.077 0 00-.079-.037 19.736 19.736 0 00-4.885 1.515.07.07 0 00-.032.027C2.042 9.043 1.196 13.58 1.49 18.057a.082.082 0 00.031.056 19.964 19.964 0 006.029 3.058.078.078 0 00.084-.027c.464-.638.875-1.31 1.226-2.017a.076.076 0 00-.041-.105 13.138 13.138 0 01-1.873-.892.077.077 0 01-.008-.128c.125-.094.25-.192.368-.291a.074.074 0 01.077-.01c3.927 1.793 8.18 1.793 12.061 0a.075.075 0 01.078.01c.119.099.243.198.368.291a.077.077 0 01-.006.128 12.64 12.64 0 01-1.874.891.075.075 0 00-.04.106c.36.704.771 1.376 1.225 2.014a.075.075 0 00.084.028 19.922 19.922 0 006.03-3.06.077.077 0 00.03-.055c.5-5.177-.838-9.673-3.548-13.66a.061.061 0 00-.03-.026zM8.02 15.331c-1.183 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.173 1.095 2.156 2.418 0 1.334-.955 2.419-2.156 2.419zm7.974 0c-1.183 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.173 1.095 2.156 2.418 0 1.334-.946 2.419-2.156 2.419z" />
    </svg>
  );
}
