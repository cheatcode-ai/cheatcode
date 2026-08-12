import { APIError, createLogger } from "@cheatcode/observability";
import { lexer, type Token, type Tokens } from "marked";
import { z } from "zod/v4";
import type { ResearchSource } from "./research-schemas";

const ResearchMarkdownSchema = z.string().trim().min(1).max(20_000).startsWith("# ");
const REJECTED_FINISH_REASONS = new Set(["content-filter", "error", "length", "tool-calls"]);
const EMOJI_PRESENTATION_PATTERN = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u;

interface ParseResearchMarkdownOptions {
  finishReason: string | undefined;
  sources: ResearchSource[];
  value: unknown;
}

/** Validates evidence-bound prose and deterministically canonicalizes its Sources section. */
export function parseResearchMarkdown(options: ParseResearchMarkdownOptions): string {
  if (options.finishReason && REJECTED_FINISH_REASONS.has(options.finishReason)) {
    throw invalidResearchMarkdown("incomplete_generation");
  }
  const parsed = ResearchMarkdownSchema.safeParse(options.value);
  if (!parsed.success) {
    throw invalidResearchMarkdown("document_shape");
  }
  if (EMOJI_PRESENTATION_PATTERN.test(parsed.data)) {
    throw invalidResearchMarkdown("unsupported_character");
  }
  const tokens = lexer(parsed.data, { gfm: true });
  return canonicalizeCitationStructure(tokens, options.sources);
}

function validateHeadingStructure(tokens: Token[]): void {
  const meaningfulTokens = tokens.filter((token) => token.type !== "space");
  const first = meaningfulTokens[0];
  const levelOneHeadings = meaningfulTokens.filter(
    (token) => isHeadingToken(token) && token.depth === 1,
  );
  if (!first || !isHeadingToken(first) || first.depth !== 1 || levelOneHeadings.length !== 1) {
    throw invalidResearchMarkdown("heading_structure");
  }
}

function canonicalizeCitationStructure(tokens: Token[], sources: ResearchSource[]): string {
  const sourceHeadingIndex = tokens.findIndex(
    (token) =>
      isHeadingToken(token) && token.depth === 2 && token.text.trim().toLowerCase() === "sources",
  );
  const bodyTokens = sourceHeadingIndex < 0 ? tokens : tokens.slice(0, sourceHeadingIndex);
  validateHeadingStructure(bodyTokens);
  if (containsUnparsedMarkdownLink(bodyTokens)) {
    throw invalidResearchMarkdown("malformed_link");
  }
  const allowedSources = new Map(
    sources.map((source) => [canonicalHttpUrl(source.url), source] as const),
  );
  const citedUrls = validateAllowedLinks(bodyTokens, new Set(allowedSources.keys()));
  if (citedUrls.size === 0) {
    throw invalidResearchMarkdown("missing_inline_citation");
  }
  const body = bodyTokens
    .map((token) => token.raw)
    .join("")
    .trimEnd();
  const sourceList = [...citedUrls].map((url) => {
    const source = allowedSources.get(url);
    if (!source) {
      throw invalidResearchMarkdown("uncollected_source");
    }
    const label = markdownLinkLabel(source.title ?? source.url);
    return `- [${label}](<${source.url}>)`;
  });
  return `${body}\n\n## Sources\n\n${sourceList.join("\n")}`;
}

function validateAllowedLinks(tokens: Token[], allowedUrls: Set<string>): Set<string> {
  const urls = new Set<string>();
  for (const link of collectLinks(tokens)) {
    const url = canonicalHttpUrl(link.href);
    if (!allowedUrls.has(url)) {
      throw invalidResearchMarkdown("uncollected_source");
    }
    urls.add(url);
  }
  return urls;
}

function collectLinks(tokens: Token[]): Tokens.Link[] {
  const links: Tokens.Link[] = [];
  for (const token of tokens) {
    if (isLinkToken(token)) {
      links.push(token);
      continue;
    }
    const children = childTokens(token);
    if (children.length > 0) {
      links.push(...collectLinks(children));
    }
  }
  return links;
}

function containsUnparsedMarkdownLink(tokens: Token[]): boolean {
  return tokens.some((token) => {
    if (isLinkToken(token) || token.type === "code" || token.type === "codespan") {
      return false;
    }
    const children = childTokens(token);
    if (children.length > 0) {
      return containsUnparsedMarkdownLink(children);
    }
    return (
      "text" in token &&
      typeof token.text === "string" &&
      /!?\[[^\]\n]+\]\([^)\n]*(?:\n|$)/u.test(token.text)
    );
  });
}

function childTokens(token: Token): Token[] {
  if ("tokens" in token && Array.isArray(token.tokens)) {
    return token.tokens;
  }
  if (isListToken(token)) {
    return token.items.flatMap((item) => item.tokens);
  }
  if (isTableToken(token)) {
    return [
      ...token.header.flatMap((cell) => cell.tokens),
      ...token.rows.flatMap((row) => row.flatMap((cell) => cell.tokens)),
    ];
  }
  return [];
}

function isHeadingToken(token: Token): token is Tokens.Heading {
  return token.type === "heading" && "depth" in token && typeof token.depth === "number";
}

function isLinkToken(token: Token): token is Tokens.Link {
  return token.type === "link" && "href" in token && typeof token.href === "string";
}

function isListToken(token: Token | undefined): token is Tokens.List {
  return Boolean(token && token.type === "list" && "items" in token && Array.isArray(token.items));
}

function isTableToken(token: Token): token is Tokens.Table {
  return token.type === "table" && "rows" in token && Array.isArray(token.rows);
}

function canonicalHttpUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw invalidResearchMarkdown("invalid_url");
    }
    url.hash = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.href;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw invalidResearchMarkdown("invalid_url");
  }
}

function markdownLinkLabel(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

type ResearchMarkdownValidationReason =
  | "document_shape"
  | "heading_structure"
  | "incomplete_generation"
  | "invalid_url"
  | "malformed_link"
  | "missing_inline_citation"
  | "unsupported_character"
  | "uncollected_source";

function invalidResearchMarkdown(reason: ResearchMarkdownValidationReason): APIError {
  createLogger().warn("research_markdown_validation_failed", { reason });
  return new APIError(
    502,
    "upstream_provider_outage",
    "Research synthesis returned invalid Markdown",
    {
      details: { reason },
      retriable: true,
    },
  );
}
