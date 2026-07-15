"use client";

import { useEffect } from "react";
import { SquareAsterisk } from "@/components/ui/icons";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { reportClientError } from "@/lib/error-reporter";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError("app-route-error-boundary");
  }, []);

  return (
    <section className="flex min-h-full min-w-0 flex-1 items-center justify-center bg-background px-6 text-foreground">
      <RecoveryCard
        action={{ label: "Reload workspace", onClick: reset }}
        announce="assertive"
        description="This workspace view stopped unexpectedly. Reload it to continue."
        detail={error.digest ? `Reference ${error.digest}` : undefined}
        headingLevel={1}
        icon={SquareAsterisk}
        title="Workspace couldn't load"
      />
    </section>
  );
}
