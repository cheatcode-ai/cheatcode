/**
 * Pure caret-token parsing for the composer trigger menus. No DOM, no React —
 * just string math over the textarea value and caret position. `/` browses durable
 * project files and `@` browses skills; both triggers begin a whitespace-delimited
 * token and may appear anywhere in the prompt.
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
 * Active iff scanning back from the caret reaches a word-start `/` without
 * crossing whitespace. Additional slashes are allowed for project paths.
 */
export function detectSlashToken(value: string, caret: number): CaretToken | null {
  return detectWordStartToken(value, caret, "/");
}

/**
 * Active iff scanning back from the caret reaches an `@` (at index 0 or preceded
 * by whitespace) without crossing whitespace first. `/` is allowed in the query so
 * path segments can be typed for file descent.
 */
export function detectMentionToken(value: string, caret: number): CaretToken | null {
  return detectWordStartToken(value, caret, "@");
}

function detectWordStartToken(value: string, caret: number, trigger: "/" | "@"): CaretToken | null {
  for (let index = caret - 1; index >= 0; index -= 1) {
    const char = value[index];
    if (char === undefined || WHITESPACE.test(char)) {
      return null;
    }
    if (char === trigger) {
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
