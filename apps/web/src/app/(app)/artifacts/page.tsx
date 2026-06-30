"use client";

import type { GeneratedOutputSummary } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useState } from "react";
import { FileContentView } from "@/components/preview/file-content-view";
import { ChevronDown, Download, FileText } from "@/components/ui/icons";
import { listGeneratedOutputs } from "@/lib/api/outputs";
import { cn } from "@/lib/ui/cn";

const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

type ArtifactPreviewKind = "image" | "none" | "pdf" | "text";

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "cjs",
  "css",
  "csv",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "markdown",
  "md",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

export default function ArtifactsPage() {
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto bg-white px-4 pt-12 pb-16 text-[#1b1b1b] sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-[740px]">
        <h1 className="font-bold text-[30px] leading-9 tracking-[-0.01em]">Artifacts</h1>
        <p className="mt-2 text-[#707070] text-[15px]">
          Files your agents generated — slides, docs, spreadsheets, PDFs, and charts.
        </p>
        <ArtifactsList />
      </div>
    </section>
  );
}

function ArtifactsList() {
  const { getToken, isSignedIn } = useAuth();
  const query = useQuery({
    enabled: Boolean(isSignedIn),
    queryFn: () => listGeneratedOutputs(getToken),
    queryKey: ["generated-outputs"],
  });

  if (query.isLoading) {
    return <p className="mt-8 text-[#a0a0a0] text-[14px]">Loading…</p>;
  }
  if (query.isError) {
    return (
      <div className="mt-8 flex items-center gap-3">
        <p className="text-[#707070] text-[14px]">Couldn’t load your artifacts.</p>
        <button
          className="rounded-full border border-[#e5e5e5] px-4 py-1.5 font-medium text-[13px] hover:bg-[#f7f7f7]"
          onClick={() => void query.refetch()}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }
  const outputs = query.data ?? [];
  if (outputs.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-[#f0f0f0] bg-[#fafafa] py-12 text-center">
        <p className="font-medium text-[#1b1b1b] text-[15px]">No artifacts yet.</p>
        <p className="mt-1 text-[#707070] text-[13px]">
          Ask an agent to build a deck, doc, or spreadsheet and it’ll show up here.
        </p>
      </div>
    );
  }
  return (
    <ul className="mt-6 flex flex-col gap-2">
      {outputs.map((output) => (
        <ArtifactRow key={output.id} output={output} />
      ))}
    </ul>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ArtifactRow({ output }: { output: GeneratedOutputSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="overflow-hidden rounded-2xl border border-[#f0f0f0] bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <FileText aria-hidden="true" className="h-5 w-5 shrink-0 text-[#a0a0a0]" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-[#1b1b1b] text-[14px]">{output.filename}</p>
            <p className="text-[#a0a0a0] text-[12px]">
              {output.kind} · {formatSize(output.sizeBytes)} ·{" "}
              {new Date(output.createdAt).toLocaleDateString()}
            </p>
          </div>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-4 w-4 shrink-0 text-[#a0a0a0] transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        <a
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#1b1b1b] px-3 font-medium text-[13px] text-white transition-colors hover:bg-black"
          download={output.filename}
          href={output.downloadUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Download aria-hidden="true" className="h-3.5 w-3.5" />
          Download
        </a>
      </div>
      {open ? <ArtifactPreview output={output} preview={classifyArtifactPreview(output)} /> : null}
    </li>
  );
}

function ArtifactPreview({
  output,
  preview,
}: {
  output: GeneratedOutputSummary;
  preview: ArtifactPreviewKind;
}) {
  if (preview === "image") {
    return (
      <div className="relative h-[480px] border-[#f0f0f0] border-t bg-[#fafafa]">
        <Image
          alt={output.filename}
          className="object-contain"
          fill
          sizes="(max-width: 740px) 100vw, 740px"
          src={output.downloadUrl}
          unoptimized
        />
      </div>
    );
  }
  if (preview === "pdf") {
    return (
      <iframe
        className="h-[520px] w-full border-[#f0f0f0] border-t bg-white"
        src={output.downloadUrl}
        title={output.filename}
      />
    );
  }
  if (preview === "text") {
    return <ArtifactTextPreview output={output} />;
  }
  return <PreviewNotice text="Preview not available for this file — download to open it." />;
}

function ArtifactTextPreview({ output }: { output: GeneratedOutputSummary }) {
  const tooLarge = output.sizeBytes > MAX_TEXT_PREVIEW_BYTES;
  const query = useQuery({
    enabled: !tooLarge,
    queryFn: () => fetchArtifactText(output.downloadUrl),
    queryKey: ["artifact-text", output.id],
    staleTime: 60_000,
  });
  if (tooLarge) {
    return <PreviewNotice text="File is too large to preview — download to open it." />;
  }
  if (query.isError) {
    return <PreviewNotice text="Couldn’t load preview — download to open it." />;
  }
  if (query.data === undefined) {
    return <PreviewNotice text="Loading preview…" />;
  }
  return (
    <div className="h-[480px] border-[#f0f0f0] border-t">
      <FileContentView content={query.data} filename={output.filename} />
    </div>
  );
}

function PreviewNotice({ text }: { text: string }) {
  return (
    <div className="border-[#f0f0f0] border-t bg-[#fafafa] px-4 py-6 text-center text-[#707070] text-[13px]">
      {text}
    </div>
  );
}

function classifyArtifactPreview(output: GeneratedOutputSummary): ArtifactPreviewKind {
  if (output.mimeType.startsWith("image/")) {
    return "image";
  }
  if (output.mimeType === "application/pdf") {
    return "pdf";
  }
  if (isTextPreviewable(output.mimeType, output.filename)) {
    return "text";
  }
  return "none";
}

function isTextPreviewable(mimeType: string, filename: string): boolean {
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return true;
  }
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  return TEXT_PREVIEW_EXTENSIONS.has(extension);
}

async function fetchArtifactText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load file (HTTP ${response.status})`);
  }
  return response.text();
}
