import type { GenerateDocumentInput } from "../../tools/docs/schemas";
import type { ResearchReport, ResearchSource } from "../workflows/research-schemas";

const MAX_NARRATIVE_SECTIONS = 60;
const MAX_APPENDIX_SECTIONS = 10;
const MAX_PARAGRAPH_LENGTH = 5_000;
const PARAGRAPHS_PER_SECTION = 20;

interface DocumentSection {
  heading: string;
  paragraphs: string[];
}

export function buildResearchReportDocument(
  report: ResearchReport,
  topic: string,
): GenerateDocumentInput {
  const title = `Research report: ${cleanInlineMarkdown(topic)}`;
  const sourceById = new Map(report.sources.map((source) => [source.id, source]));
  const narrative = narrativeSections(report.report).slice(0, MAX_NARRATIVE_SECTIONS);
  const evidence = appendixSections(
    "Evidence map",
    report.claims.map((claim) => evidenceParagraph(claim.claim, claim.sourceIds, sourceById)),
  );
  const sources = appendixSections("Sources", report.sources.map(sourceParagraph));

  return {
    filename: researchFilename(topic),
    sections: [...narrative, ...evidence, ...sources],
    title: clampText(title),
  };
}

function narrativeSections(markdown: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let heading = "Research findings";
  let paragraphs: string[] = [];

  for (const block of markdown.split(/\n\s*\n/u)) {
    const lines = block.split("\n").map((line) => line.trim());
    const firstLine = lines[0] ?? "";
    const headingMatch = /^(?:#{1,6})\s+(.+)$/u.exec(firstLine);
    if (headingMatch) {
      appendSection(sections, heading, paragraphs);
      heading = cleanInlineMarkdown(headingMatch[1] ?? "Research findings");
      paragraphs = lines.slice(1).flatMap(cleanDocumentLine);
      continue;
    }
    paragraphs.push(...lines.flatMap(cleanDocumentLine));
  }

  appendSection(sections, heading, paragraphs);
  return sections.length > 0
    ? sections
    : [{ heading: "Research findings", paragraphs: [clampText(cleanInlineMarkdown(markdown))] }];
}

function appendSection(sections: DocumentSection[], heading: string, paragraphs: string[]): void {
  for (const [index, chunk] of chunks(paragraphs, PARAGRAPHS_PER_SECTION).entries()) {
    sections.push({
      heading: index === 0 ? clampText(heading) : clampText(`${heading} (continued)`),
      paragraphs: chunk,
    });
  }
}

function appendixSections(heading: string, paragraphs: string[]): DocumentSection[] {
  return chunks(paragraphs, PARAGRAPHS_PER_SECTION)
    .slice(0, MAX_APPENDIX_SECTIONS)
    .map((chunk, index) => ({
      heading: index === 0 ? heading : `${heading} (continued)`,
      paragraphs: chunk,
    }));
}

function evidenceParagraph(
  claim: string,
  sourceIds: string[],
  sourceById: ReadonlyMap<string, ResearchSource>,
): string {
  const sources = sourceIds
    .map((sourceId) => sourceById.get(sourceId))
    .filter((source): source is ResearchSource => source !== undefined)
    .map(sourceLabel);
  return clampText(`${cleanInlineMarkdown(claim)}\nSources: ${sources.join("; ")}`);
}

function sourceParagraph(source: ResearchSource): string {
  return clampText(`${source.title?.trim() || source.url}\n${source.url}`);
}

function sourceLabel(source: ResearchSource): string {
  return source.title?.trim() ? `${source.title.trim()} (${source.url})` : source.url;
}

function cleanDocumentLine(line: string): string[] {
  const cleaned = cleanInlineMarkdown(line)
    .replace(/^[-*+]\s+/u, "• ")
    .replace(/^\d+[.)]\s+/u, (prefix) => `${prefix} `)
    .replace(/^\|(.+)\|$/u, "$1")
    .replace(/\s*\|\s*/gu, " — ")
    .trim();
  return cleaned && !/^[-: ]+$/u.test(cleaned) ? [clampText(cleaned)] : [];
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gu, "$1 ($2)")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/[*_~]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
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

function clampText(value: string): string {
  const normalized = value.trim();
  return normalized.length <= MAX_PARAGRAPH_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_PARAGRAPH_LENGTH - 1)}…`;
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}
