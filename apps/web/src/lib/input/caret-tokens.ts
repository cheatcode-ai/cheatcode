/**
 * Pure caret-token parsing for the composer trigger menus. No DOM, no React —
 * just string math over the textarea value and caret position. `detectSlashToken`
 * only fires for a leading `/` prefix (matching the established "slash means
 * something only as a prompt prefix" convention); `detectMentionToken` fires for
 * an inline `@` that begins a word.
 */
export interface CaretToken {
  /** Caret position (exclusive end of the matched query text). */
  end: number;
  /** Text between the trigger character and the caret. */
  query: string;
  /** Index of the trigger character (`/` or `@`). */
  start: number;
}

const WHITESPACE = /\s/;

/**
 * Active iff `/` is the first non-whitespace character of the whole value and the
 * caret sits inside that first whitespace-delimited token.
 */
export function detectSlashToken(value: string, caret: number): CaretToken | null {
  const firstNonWhitespace = value.search(/\S/);
  if (firstNonWhitespace === -1 || value[firstNonWhitespace] !== "/") {
    return null;
  }
  let tokenEnd = firstNonWhitespace + 1;
  while (tokenEnd < value.length && !WHITESPACE.test(value[tokenEnd] ?? "")) {
    tokenEnd += 1;
  }
  if (caret <= firstNonWhitespace || caret > tokenEnd) {
    return null;
  }
  return {
    end: caret,
    query: value.slice(firstNonWhitespace + 1, caret),
    start: firstNonWhitespace,
  };
}

/**
 * Active iff scanning back from the caret reaches an `@` (at index 0 or preceded
 * by whitespace) without crossing whitespace first. `/` is allowed in the query so
 * path segments can be typed for file descent.
 */
export function detectMentionToken(value: string, caret: number): CaretToken | null {
  for (let index = caret - 1; index >= 0; index -= 1) {
    const char = value[index];
    if (char === undefined || WHITESPACE.test(char)) {
      return null;
    }
    if (char === "@") {
      const previous = index > 0 ? value[index - 1] : undefined;
      const isWordStart = index === 0 || (previous !== undefined && WHITESPACE.test(previous));
      if (!isWordStart) {
        return null;
      }
      return {
        end: caret,
        query: value.slice(index + 1, caret),
        start: index,
      };
    }
  }
  return null;
}

/**
 * Replaces the token range with `insert`, returning the new value and the caret
 * position immediately after the inserted text.
 */
export function replaceToken(
  value: string,
  token: CaretToken,
  insert: string,
): { caret: number; value: string } {
  const nextValue = value.slice(0, token.start) + insert + value.slice(token.end);
  return { caret: token.start + insert.length, value: nextValue };
}
