import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";

/** Bare brand-mark loading state for sandbox and preview cold starts. */
export function BootingComputer({ label = "Booting computer" }: { label?: string }) {
  return (
    <CheatcodeLoader
      className="h-full min-h-[420px] min-w-0 flex-1 bg-bg-secondary"
      label={label}
    />
  );
}
