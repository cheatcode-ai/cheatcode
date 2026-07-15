import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { cn } from "@/lib/ui/cn";

type CheatcodeLoaderProps = {
  className?: string | undefined;
  label?: string | undefined;
  markClassName?: string | undefined;
};

/** The single visual loading treatment across Cheatcode: the bare animated brand mark. */
export function CheatcodeLoader({
  className,
  label = "Loading",
  markClassName,
}: CheatcodeLoaderProps) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={cn("flex items-center justify-center", className)}
      role="status"
    >
      <CheatcodeMark
        aria-hidden="true"
        className={cn("cc-loading-mark size-10 text-primary", markClassName)}
      />
    </div>
  );
}
