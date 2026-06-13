import Image from "next/image";
import Link from "next/link";
import { WORKSPACE_NAV } from "@/lib/navigation/nav-model";

// Friendly labels for the 404 quick-links; hrefs are resolved from the nav model
// so routes live in one place. (ASCII art lands here in the Bud UI round.)
const QUICK_LINKS: readonly { id: string; label: string }[] = [
  { id: "new-task", label: "Home" },
  { id: "projects", label: "Workspace" },
  { id: "skills", label: "Skills" },
];

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-thread-panel px-6 text-thread-text-primary">
      <section className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-thread-border bg-thread-surface">
            <Image alt="" height={24} priority src="/cheatcode-symbol.png" width={24} />
          </div>
        </div>
        <p className="mb-3 font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.28em]">
          404
        </p>
        <h1 className="font-medium text-2xl text-white tracking-tight">Page not found</h1>
        <p className="mx-auto mt-4 max-w-sm text-sm text-thread-text-muted leading-relaxed">
          Were you looking for one of these?
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {QUICK_LINKS.map((link) => {
            const href = hrefForNavItem(link.id);
            if (!href) {
              return null;
            }
            return (
              <Link
                className="inline-flex h-10 items-center justify-center rounded-xl border border-thread-border bg-thread-surface px-5 font-medium text-thread-text-secondary transition-colors hover:border-thread-border-hover hover:bg-thread-surface-hover hover:text-thread-text-primary"
                href={href}
                key={link.id}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function hrefForNavItem(id: string): string | null {
  const item = WORKSPACE_NAV.find((candidate) => candidate.id === id);
  return item && item.target.kind === "route" ? item.target.href : null;
}
