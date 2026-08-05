import { APIError } from "@cheatcode/observability";
import { lexer, type Token, type Tokens } from "marked";
import { z } from "zod/v4";
import type { ResearchSource } from "./research-schemas";

const ResearchMarkdownSchema = z.string().trim().min(1).max(20_000).startsWith("# ");
const REJECTED_FINISH_REASONS = new Set(["content-filter", "error", "length", "tool-calls"]);

interface ParseResearchMarkdownOptions {
  finishReason: string | undefined;
  sources: ResearchSource[];
  value: unknown;
}

/** Validates the complete, evidence-bound Markdown contract before artifact publication. */
export function parseResearchMarkdown(options: ParseResearchMarkdownOptions): string {
  if (options.finishReason && REJECTED_FINISH_REASONS.has(options.finishReason)) {
    throw invalidResearchMarkdown();
  }
  const parsed = ResearchMarkdownSchema.safeParse(options.value);
  if (!parsed.success) {
    throw invalidResearchMarkdown();
  }
  const tokens = lexer(parsed.data, { gfm: true });
  validateHeadingStructure(tokens);
  validateCitationStructure(tokens, options.sources);
  return parsed.data;
}

function validateHeadingStructure(tokens: Token[]): void {
  const meaningfulTokens = tokens.filter((token) => token.type !== "space");
  const first = meaningfulTokens[0];
  const levelOneHeadings = meaningfulTokens.filter(
    (token) => isHeadingToken(token) && token.depth === 1,
  );
  if (!first || !isHeadingToken(first) || first.depth !== 1 || levelOneHeadings.length !== 1) {
    throw invalidResearchMarkdown();
  }
}

function validateCitationStructure(tokens: Token[], sources: ResearchSource[]): void {
  const sourceHeadingIndexes = tokens.flatMap((token, index) =>
    isHeadingToken(token) && token.depth === 2 && token.text.trim().toLowerCase() === "sources"
      ? [index]
      : [],
  );
  if (sourceHeadingIndexes.length !== 1) {
    throw invalidResearchMarkdown();
  }
  const sourceHeadingIndex = sourceHeadingIndexes[0];
  if (sourceHeadingIndex === undefined) {
    throw invalidResearchMarkdown();
  }
  const sourceBlocks = tokens
    .slice(sourceHeadingIndex + 1)
    .filter((token) => token.type !== "space");
  const sourceList = sourceBlocks[0];
  if (
    sourceBlocks.length !== 1 ||
    !isListToken(sourceList) ||
    sourceList.ordered ||
    sourceList.items.length === 0 ||
    containsUnparsedMarkdownLink(tokens)
  ) {
    throw invalidResearchMarkdown();
  }

  const allowedUrls = new Set(sources.map((source) => canonicalHttpUrl(source.url)));
  const bodyUrls = validateAllowedLinks(tokens.slice(0, sourceHeadingIndex), allowedUrls);
  const listedUrls = validateSourceList(sourceList, allowedUrls);
  if (bodyUrls.size === 0 || !setsEqual(bodyUrls, listedUrls)) {
    throw invalidResearchMarkdown();
  }
}

function validateAllowedLinks(tokens: Token[], allowedUrls: Set<string>): Set<string> {
  const urls = new Set<string>();
  for (const link of collectLinks(tokens)) {
    const url = canonicalHttpUrl(link.href);
    if (!allowedUrls.has(url)) {
      throw invalidResearchMarkdown();
    }
    urls.add(url);
  }
  return urls;
}

function validateSourceList(sourceList: Tokens.List, allowedUrls: Set<string>): Set<string> {
  const urls = new Set<string>();
  for (const item of sourceList.items) {
    const links = collectLinks(item.tokens);
    if (links.length !== 1 || textOutsideLinks(item.tokens).trim()) {
      throw invalidResearchMarkdown();
    }
    const url = canonicalHttpUrl(links[0]?.href);
    if (!allowedUrls.has(url) || urls.has(url)) {
      throw invalidResearchMarkdown();
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

function textOutsideLinks(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === "link" || token.type === "space") {
        return "";
      }
      const children = childTokens(token);
      if (children.length > 0) {
        return textOutsideLinks(children);
      }
      return "text" in token && typeof token.text === "string" ? token.text : "";
    })
    .join("");
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
      throw invalidResearchMarkdown();
    }
    return url.href;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw invalidResearchMarkdown();
  }
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function invalidResearchMarkdown(): APIError {
  return new APIError(
    502,
    "upstream_provider_outage",
    "Research synthesis returned invalid Markdown",
    {
      retriable: true,
    },
  );
}
