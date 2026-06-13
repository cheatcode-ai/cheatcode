"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/error-reporter";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "global-error-boundary");
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
          <section className="w-full max-w-md text-center">
            <p className="mb-3 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.28em]">
              Critical error
            </p>
            <h1 className="font-medium text-2xl tracking-tight">Cheatcode needs to reload</h1>
            <p className="mx-auto mt-4 max-w-sm text-sm text-zinc-500 leading-relaxed">
              The app hit an unrecoverable client error. The report was sent to the gateway
              telemetry endpoint.
            </p>
            {error.digest ? (
              <p className="mt-4 font-mono text-[10px] text-zinc-700 uppercase tracking-[0.2em]">
                {error.digest}
              </p>
            ) : null}
            <button
              className="mt-8 inline-flex h-10 items-center justify-center rounded-xl bg-white px-5 font-medium text-black transition-colors hover:bg-zinc-200"
              onClick={reset}
              type="button"
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
