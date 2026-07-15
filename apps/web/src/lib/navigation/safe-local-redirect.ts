/**
 * Normalizes a redirect target and rejects targets outside the current origin.
 * URL parsing also closes protocol-relative and backslash-based redirect bypasses.
 */
export function safeLocalRedirect(value: string, origin: string): string | null {
  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
