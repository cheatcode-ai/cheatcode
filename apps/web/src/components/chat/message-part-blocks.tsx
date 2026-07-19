import { RotateCw } from "@cheatcode/ui";

export function ErrorRecoveryBlock({
  message,
  onContinue,
}: {
  message: string;
  onContinue?: (() => void) | undefined;
}) {
  return (
    <div className="cc-fade-in overflow-hidden rounded-[20px] border-2 border-border bg-background p-0.5">
      <div className="flex min-h-[68px] items-center gap-4 rounded-[16px] bg-gradient-to-b from-danger-bg to-background px-4 py-3.5">
        <p className="min-w-0 flex-1 text-[14px] text-danger-fg leading-5">{message}</p>
        {onContinue ? (
          <button
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 font-medium text-[13px] text-background transition-[background-color,transform] duration-150 hover:bg-foreground/90 active:scale-[0.97] motion-reduce:transition-none"
            onClick={onContinue}
            type="button"
          >
            <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
            Continue
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function errorRecoveryMessage(code: string, fallback: string): string {
  return code === "run_interrupted"
    ? "This run stopped before it finished. Continue from where it left off."
    : fallback;
}

export function DataBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="cc-fade-in rounded-[14px] border border-thread-border bg-[var(--thread-code-bg)] p-3 font-mono text-[11px] text-thread-text-secondary">
      <div className="mb-2 text-[10px] text-thread-text-muted">{title}</div>
      <pre className="whitespace-pre-wrap break-words">{value}</pre>
    </div>
  );
}
