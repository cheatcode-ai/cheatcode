export type ConfigRecord = Record<string, unknown>;

/** Matches a JSON string literal (group 1), a `//` line comment, or a block comment. */
const JSONC_TOKEN = /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
/** Matches a JSON string literal (group 1) or a trailing comma plus its closing token. */
const JSONC_TRAILING_COMMA = /("(?:\\.|[^"\\])*")|,(\s*[}\]])/g;

export function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsoncObject(input: string, label: string): ConfigRecord {
  const normalized = input
    .replace(JSONC_TOKEN, (match, stringLiteral?: string) =>
      stringLiteral ? stringLiteral : match.replace(/[^\r\n]/g, " "),
    )
    .replace(
      JSONC_TRAILING_COMMA,
      (_match, stringLiteral?: string, closingToken?: string) =>
        stringLiteral ?? closingToken ?? "",
    );
  const parsed = JSON.parse(normalized) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} must parse to a JSON object.`);
  }
  return parsed;
}
