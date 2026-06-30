"use client";

import hljs from "highlight.js/lib/common";
import Papa from "papaparse";
import { useMemo } from "react";
import { Response } from "@/components/ai-elements/response";

const MAX_CSV_ROWS = 500;
const MAX_HIGHLIGHT_CHARS = 200_000;

/** File extension -> highlight.js language id. JSON is pretty-printed separately. */
const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  cjs: "javascript",
  css: "css",
  go: "go",
  html: "xml",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

/**
 * Light-theme highlight.js token colors scoped to `.cc-codeview`. The global
 * theme in globals.css is dark + markdown-scoped, so the standalone code viewer
 * ships its own warm-paper palette. React 19 hoists + de-dupes this `<style>`.
 */
const HLJS_LIGHT_CSS = `
.cc-codeview .hljs-comment,
.cc-codeview .hljs-quote {
  color: #9b9b9b;
  font-style: italic;
}
.cc-codeview .hljs-keyword,
.cc-codeview .hljs-selector-tag,
.cc-codeview .hljs-literal,
.cc-codeview .hljs-doctag,
.cc-codeview .hljs-section,
.cc-codeview .hljs-name {
  color: #8250df;
}
.cc-codeview .hljs-string,
.cc-codeview .hljs-attr,
.cc-codeview .hljs-addition,
.cc-codeview .hljs-regexp,
.cc-codeview .hljs-meta-string {
  color: #1a7f37;
}
.cc-codeview .hljs-number,
.cc-codeview .hljs-built_in,
.cc-codeview .hljs-type,
.cc-codeview .hljs-class,
.cc-codeview .hljs-symbol,
.cc-codeview .hljs-variable,
.cc-codeview .hljs-template-variable {
  color: #0550ae;
}
.cc-codeview .hljs-title,
.cc-codeview .hljs-tag,
.cc-codeview .hljs-selector-id,
.cc-codeview .hljs-selector-class {
  color: #953800;
}
.cc-codeview .hljs-deletion {
  color: #cf222e;
}
.cc-codeview .hljs-meta {
  color: #9b9b9b;
}
.cc-codeview .hljs-emphasis {
  font-style: italic;
}
.cc-codeview .hljs-strong {
  font-weight: 600;
}
`;

interface CsvTable {
  header: string[];
  hiddenRows: number;
  rows: string[][];
}

/**
 * Presentational, type-aware file renderer (no data fetching). Beats bud's
 * download-only fallback by rendering CSV/TSV as scrollable tables, markdown,
 * pretty-printed JSON, and syntax-highlighted code inline.
 */
export function FileContentView({ content, filename }: { content: string; filename: string }) {
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (extension === "csv") {
    return <CsvTableView content={content} delimiter="" />;
  }
  if (extension === "tsv") {
    return <CsvTableView content={content} delimiter={"\t"} />;
  }
  if (extension === "md" || extension === "markdown") {
    return <MarkdownView content={content} />;
  }
  if (extension === "json") {
    return <CodeView content={prettyJson(content)} language="json" />;
  }
  const language = CODE_LANGUAGE_BY_EXTENSION[extension];
  if (language) {
    return <CodeView content={content} language={language} />;
  }
  return <PlainTextView content={content} />;
}

function CsvTableView({ content, delimiter }: { content: string; delimiter: string }) {
  const table = useMemo(() => parseCsv(content, delimiter), [content, delimiter]);
  if (!table) {
    return <PlainTextView content={content} />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="chat-scrollbar min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 z-10 bg-thread-surface">
            <tr>
              {table.header.map((cell, columnIndex) => (
                <th
                  className="whitespace-nowrap border border-thread-border-subtle px-2.5 py-1.5 text-left font-semibold text-thread-text-primary"
                  // biome-ignore lint/suspicious/noArrayIndexKey: CSV columns have no stable identity
                  key={columnIndex}
                  scope="col"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <CsvRow
                cells={row}
                // biome-ignore lint/suspicious/noArrayIndexKey: CSV rows have no stable identity
                key={rowIndex}
              />
            ))}
          </tbody>
        </table>
      </div>
      {table.hiddenRows > 0 ? (
        <div className="shrink-0 border-thread-border-subtle border-t bg-white px-3 py-2 text-[11px] text-thread-text-tertiary">
          +{table.hiddenRows.toLocaleString()} more rows
        </div>
      ) : null}
    </div>
  );
}

function CsvRow({ cells }: { cells: string[] }) {
  return (
    <tr className="even:bg-[#fafafa]">
      {cells.map((cell, columnIndex) => (
        <td
          className="whitespace-nowrap border border-thread-border-subtle px-2.5 py-1 align-top text-thread-text-secondary"
          // biome-ignore lint/suspicious/noArrayIndexKey: CSV cells have no stable identity
          key={columnIndex}
        >
          {cell}
        </td>
      ))}
    </tr>
  );
}

function MarkdownView({ content }: { content: string }) {
  return (
    <div className="chat-scrollbar h-full overflow-auto bg-white p-4">
      <div className="chat-markdown max-w-none text-[#1b1b1b] text-[14px] leading-6">
        <Response>{content}</Response>
      </div>
    </div>
  );
}

function CodeView({ content, language }: { content: string; language: string }) {
  const html = useMemo(() => highlightCode(content, language), [content, language]);
  const lineNumbers = useMemo(() => lineNumbersFor(content), [content]);
  if (html === null) {
    return <PlainTextView content={content} />;
  }
  return (
    <div className="cc-codeview chat-scrollbar h-full overflow-auto bg-white">
      <HljsTheme />
      <div className="flex min-h-full min-w-max">
        <pre
          aria-hidden="true"
          className="sticky left-0 min-h-full select-none border-[#f1f1f1] border-r bg-white px-3 py-3 text-right font-mono text-[#9b9b9b] text-[12px] leading-5"
        >
          {lineNumbers}
        </pre>
        <pre className="min-h-full px-3 py-3 font-mono text-[12px] leading-5">
          <code
            className={`hljs language-${language} text-[#383a42]`}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js HTML-escapes the source before tokenizing, so its output is XSS-safe.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
    </div>
  );
}

function HljsTheme() {
  return (
    <style href="cc-codeview-hljs" precedence="default">
      {HLJS_LIGHT_CSS}
    </style>
  );
}

function PlainTextView({ content }: { content: string }) {
  const lineNumbers = useMemo(() => lineNumbersFor(content), [content]);
  return (
    <div className="chat-scrollbar h-full overflow-auto bg-white">
      <div className="flex min-h-full min-w-max">
        <pre
          aria-hidden="true"
          className="sticky left-0 min-h-full select-none border-[#f1f1f1] border-r bg-white px-3 py-3 text-right font-mono text-[#9b9b9b] text-[12px] leading-5"
        >
          {lineNumbers}
        </pre>
        <pre className="min-h-full px-3 py-3 font-mono text-[#383a42] text-[12px] leading-5">
          {content}
        </pre>
      </div>
    </div>
  );
}

function lineNumbersFor(content: string): string {
  const lineCount = Math.max(1, content.split("\n").length);
  return Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
}

function parseCsv(content: string, delimiter: string): CsvTable | null {
  const result = Papa.parse<string[]>(content, { delimiter, skipEmptyLines: true });
  const [header, ...body] = result.data;
  if (!header || header.length === 0) {
    return null;
  }
  const rows = body.slice(0, MAX_CSV_ROWS);
  return { header, hiddenRows: body.length - rows.length, rows };
}

function highlightCode(content: string, language: string): string | null {
  if (content.length > MAX_HIGHLIGHT_CHARS) {
    return null;
  }
  try {
    if (hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value;
    }
    return hljs.highlightAuto(content).value;
  } catch {
    return null;
  }
}

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
