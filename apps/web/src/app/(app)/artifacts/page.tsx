"use client";

import type { GeneratedOutputSummary } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "@/components/ui/icons";
import { listGeneratedOutputs } from "@/lib/api/outputs";

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
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-[#f0f0f0] bg-white px-4 py-3">
      <FileText aria-hidden="true" className="h-5 w-5 shrink-0 text-[#a0a0a0]" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-[#1b1b1b] text-[14px]">{output.filename}</p>
        <p className="text-[#a0a0a0] text-[12px]">
          {output.kind} · {formatSize(output.sizeBytes)} ·{" "}
          {new Date(output.createdAt).toLocaleDateString()}
        </p>
      </div>
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
    </li>
  );
}
