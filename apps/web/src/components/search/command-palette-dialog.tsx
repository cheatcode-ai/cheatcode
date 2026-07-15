import { ModalShell } from "@cheatcode/ui";
import { Command } from "cmdk";
import { Search } from "@/components/ui/icons";
import { CommandPaletteResults } from "./command-palette-results";
import type { useCommandPalette } from "./use-command-palette";

export function CommandPaletteDialog({
  palette,
}: {
  palette: ReturnType<typeof useCommandPalette>;
}) {
  return (
    <ModalShell
      ariaLabel="Search projects and threads"
      className="m-auto w-full max-w-xl"
      onClose={palette.close}
      open={palette.open}
    >
      <Command
        className="flex max-h-[60vh] flex-col overflow-hidden text-foreground"
        label="Search projects and threads"
        shouldFilter={false}
      >
        <div className="flex items-center gap-2 border-border border-b px-4">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-placeholder" />
          <Command.Input
            className="h-12 w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-placeholder"
            onValueChange={palette.setQuery}
            placeholder="Search projects and threads…"
            value={palette.query}
          />
        </div>
        <CommandPaletteResults palette={palette} />
      </Command>
    </ModalShell>
  );
}
