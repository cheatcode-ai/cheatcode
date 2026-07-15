import { cn } from "@/lib/ui/cn";
import type { ModelSourceChoice } from "./models-panel-model";

export function ModelSourceList({
  choices,
  onSelect,
  open,
}: {
  choices: ModelSourceChoice[];
  onSelect: (choice: ModelSourceChoice) => void;
  open: boolean;
}) {
  return (
    <div
      className={cn(
        "transform-gpu pr-4 pb-3 pl-20 transition-[transform,opacity] duration-200 ease-out",
        open ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
      )}
    >
      <div className="relative flex flex-col pl-5">
        {choices.map((choice, index) => (
          <ModelSourceChoiceRow
            choice={choice}
            isLast={index === choices.length - 1}
            key={choice.id}
            onSelect={onSelect}
            open={open}
          />
        ))}
      </div>
    </div>
  );
}

function ModelSourceChoiceRow({
  choice,
  isLast,
  onSelect,
  open,
}: {
  choice: ModelSourceChoice;
  isLast: boolean;
  onSelect: (choice: ModelSourceChoice) => void;
  open: boolean;
}) {
  const branch = choice.active ? "var(--fg-primary)" : "var(--border-tree)";
  return (
    <div className="group/item relative z-0">
      <span
        aria-hidden="true"
        className="absolute top-2 -left-8 z-10 h-2.5 w-4 rounded-bl-[10px] border-b-[1.5px] border-l-[1.5px]"
        style={{ borderColor: branch }}
      />
      <span
        aria-hidden="true"
        className="absolute top-0 -left-8 h-2 w-[1.5px]"
        style={{ backgroundColor: branch }}
      />
      {isLast ? null : (
        <span
          aria-hidden="true"
          className="absolute top-2 bottom-0 -left-8 w-[1.5px] bg-border-tree"
        />
      )}
      <SourceChoiceNode active={Boolean(choice.active)} />
      <SourceChoiceButton choice={choice} onSelect={onSelect} open={open} />
    </div>
  );
}

function SourceChoiceNode({ active }: { active: boolean }) {
  return active ? (
    <span
      aria-hidden="true"
      className="absolute top-[18px] -left-3.5 z-10 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-foreground"
    >
      <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" fill="currentColor" r="10" />
        <path
          d="m8 12.5 2.5 2.5L16 9"
          fill="none"
          stroke="white"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-[18px] -left-3.5 z-10 hidden size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background text-fg-secondary group-focus-within/item:flex group-hover/item:flex"
    >
      <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 8v8m4-4H8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}

function SourceChoiceButton({
  choice,
  onSelect,
  open,
}: {
  choice: ModelSourceChoice;
  onSelect: (choice: ModelSourceChoice) => void;
  open: boolean;
}) {
  return (
    <button
      aria-current={choice.active ? "true" : undefined}
      className={cn(
        "-ml-3 flex h-[35px] w-full items-center gap-3 rounded-[10px] px-3 py-[11px] text-left outline-none",
        choice.active ? "cursor-default" : "cursor-pointer",
      )}
      onClick={() => {
        if (!choice.active) {
          onSelect(choice);
        }
      }}
      tabIndex={open ? 0 : -1}
      type="button"
    >
      <span className="min-w-0 truncate text-[13px] leading-none">{choice.label}</span>
    </button>
  );
}
