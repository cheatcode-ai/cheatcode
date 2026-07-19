"use client";

import { SquareAsterisk } from "@cheatcode/ui";
import { useEffect } from "react";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { reportClientError } from "@/lib/error-reporter";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError("global-error-boundary");
  }, []);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
          <RecoveryCard
            action={{ label: "Reload Cheatcode", onClick: reset }}
            announce="assertive"
            description="Cheatcode stopped unexpectedly. Reload the app to continue."
            detail={error.digest ? `Reference ${error.digest}` : undefined}
            headingLevel={1}
            icon={SquareAsterisk}
            title="Cheatcode needs to reload"
          />
        </main>
      </body>
    </html>
  );
}
