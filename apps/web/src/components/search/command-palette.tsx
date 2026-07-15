"use client";

import { CommandPaletteDialog } from "./command-palette-dialog";
import { useCommandPalette } from "./use-command-palette";

/**
 * Global ⌘K / Ctrl+K command palette backed by the server-side workspace search.
 * cmdk owns keyboard navigation and selection; matching remains server-side.
 */
export function CommandPalette() {
  const palette = useCommandPalette();
  return palette.isSignedIn ? <CommandPaletteDialog palette={palette} /> : null;
}
