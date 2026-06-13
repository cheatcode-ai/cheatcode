"use client";

import { useEffect } from "react";
import { RefreshCw } from "@/components/ui/icons";
import { reportClientError } from "@/lib/error-reporter";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "app-route-error-boundary");
  }, [error]);

  return (
    <section className="flex min-h-full min-w-0 flex-1 items-center justify-center bg-thread-panel px-6 text-thread-text-primary">
      <div className="w-full max-w-md text-center">
        <p className="mb-3 font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.28em]">
          Error
        </p>
        <h1 className="font-medium text-2xl text-white tracking-tight">Something went wrong</h1>
        <p className="mx-auto mt-4 max-w-sm text-sm text-thread-text-muted leading-relaxed">
          The current workspace view failed to render. Retry keeps the current route and asks Next
          to reload this segment.
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
          <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
          Try again
        </button>
      </div>
    </section>
  );
}
