import Image from "next/image";
import Link from "next/link";

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
          The route does not exist in this Cheatcode workspace.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-5 font-medium text-black transition-colors hover:bg-zinc-200"
            href="/projects"
          >
            Open workspace
          </Link>
          <Link
            className="inline-flex h-10 items-center justify-center rounded-xl border border-thread-border bg-thread-surface px-5 font-medium text-thread-text-secondary transition-colors hover:border-thread-border-hover hover:bg-thread-surface-hover hover:text-thread-text-primary"
            href="/"
          >
            Go home
          </Link>
        </div>
      </section>
    </main>
  );
}
