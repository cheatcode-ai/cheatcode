import Image from "next/image";
import Link from "next/link";
import { WORKSPACE_NAV } from "@/lib/navigation/nav-model";

// Friendly labels for the 404 quick-links; hrefs are resolved from the nav model
// so routes live in one place.
const QUICK_LINKS: readonly { id: string; label: string }[] = [
  { id: "new-task", label: "Home" },
  { id: "skills", label: "Skills" },
];

export default function NotFound() {
  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground"
      id="main-content"
      tabIndex={-1}
    >
      <section className="w-full max-w-md rounded-[28px] border border-border bg-bg-secondary p-1 text-center">
        <div className="rounded-[24px] bg-background px-6 py-12">
          <div className="mb-8 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-border bg-bg-secondary">
              <Image alt="" height={24} priority src="/cheatcode-symbol.png" width={24} />
            </div>
          </div>
          <p className="mb-3 font-mono text-[10px] text-placeholder uppercase tracking-[0.28em]">
            404
          </p>
          <h1 className="font-bold text-[24px] text-foreground leading-[32px] tracking-normal">
            Page not found
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-fg-secondary text-sm leading-relaxed">
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
                  className="inline-flex h-10 items-center justify-center rounded-full border border-border bg-background px-5 font-medium text-fg-secondary transition-colors hover:border-border hover:bg-bg-secondary hover:text-foreground"
                  href={href}
                  key={link.id}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

function hrefForNavItem(id: string): string | null {
  const item = WORKSPACE_NAV.find((candidate) => candidate.id === id);
  return item && item.target.kind === "route" ? item.target.href : null;
}
