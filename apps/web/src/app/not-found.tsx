import Image from "next/image";
import Link from "next/link";
import { WORKSPACE_NAV } from "@/lib/navigation/nav-model";

// Friendly labels for the 404 quick-links; hrefs are resolved from the nav model
// so routes live in one place.
const QUICK_LINKS: readonly { id: string; label: string }[] = [
  { id: "new-task", label: "Home" },
  { id: "skills", label: "Skills" },
  { id: "tools", label: "Tools" },
];

export default function NotFound() {
  return (
    <main className="paper-dot-field flex min-h-screen items-center justify-center bg-white px-6 text-[#1b1b1b]">
      <section className="w-full max-w-md rounded-[28px] border border-[#f1f1f1] bg-[#f8f8f8] p-1 text-center">
        <div className="rounded-[24px] bg-white px-6 py-12">
          <div className="mb-8 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[#f1f1f1] bg-[#fafafa]">
              <Image alt="" height={24} priority src="/cheatcode-symbol.png" width={24} />
            </div>
          </div>
          <p className="mb-3 font-mono text-[#a0a0a0] text-[10px] uppercase tracking-[0.28em]">
            404
          </p>
          <h1 className="font-bold text-[#1b1b1b] text-[24px] leading-[32px] tracking-normal">
            Page not found
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-[#707070] text-sm leading-relaxed">
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
                  className="inline-flex h-10 items-center justify-center rounded-full border border-[#f1f1f1] bg-white px-5 font-medium text-[#4f4f4f] transition-colors hover:border-[#dedede] hover:bg-[#fafafa] hover:text-[#1b1b1b]"
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
