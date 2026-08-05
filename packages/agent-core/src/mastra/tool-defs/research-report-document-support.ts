import type { GenerateMarkdownPdfInput } from "../../tools/docs/schemas";

export function buildResearchMarkdownPdfInput(
  markdown: string,
  topic: string,
): GenerateMarkdownPdfInput {
  const fallbackTitle = cleanTitle(topic) || "Research";
  return {
    filename: researchFilename(topic),
    markdown,
    title: markdownTitle(markdown) ?? `Research report: ${fallbackTitle}`,
  };
}

function markdownTitle(markdown: string): string | undefined {
  const heading = /^#\s+(.+)$/mu.exec(markdown)?.[1];
  const title = heading ? cleanTitle(heading) : "";
  return title || undefined;
}

function researchFilename(topic: string): string {
  const slug = topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 110);
  return `research-${slug || "report"}.pdf`;
}

function cleanTitle(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[`*_~]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 5_000);
}
