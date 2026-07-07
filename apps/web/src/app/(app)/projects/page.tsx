import Link from "next/link";

// Bud does not expose a standalone projects dashboard. Projects stay available
// through the sidebar picker, while direct `/projects` visits render an app-shell
// 404 instead of a separate management screen.
export default function ProjectsPage() {
  return (
    <section className="flex min-h-screen flex-1 items-center justify-center bg-white px-6 text-[#1b1b1b]">
      <div className="w-full max-w-md rounded-[28px] border border-[#f1f1f1] bg-[#f8f8f8] p-1 text-center">
        <div className="rounded-[24px] bg-white px-6 py-12">
          <p className="mb-3 font-mono text-[#a0a0a0] text-[10px] uppercase tracking-[0.28em]">
            404
          </p>
          <h1 className="font-semibold text-[#1b1b1b] text-[24px] leading-8">Page not found</h1>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              className="inline-flex h-10 items-center justify-center rounded-full border border-[#f1f1f1] bg-white px-5 font-medium text-[#4f4f4f] transition-colors hover:border-[#dedede] hover:bg-[#fafafa] hover:text-[#1b1b1b]"
              href="/"
            >
              Home
            </Link>
            <Link
              className="inline-flex h-10 items-center justify-center rounded-full border border-[#f1f1f1] bg-white px-5 font-medium text-[#4f4f4f] transition-colors hover:border-[#dedede] hover:bg-[#fafafa] hover:text-[#1b1b1b]"
              href="/automations"
            >
              Automations
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
