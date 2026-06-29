"use client";

import type {
  ApprovalDecisionData,
  ApprovalRequestData,
  ModelFallbackData,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { decideRunApproval } from "@/lib/api/project-thread";

type ApprovalChoice = "allow" | "deny";

const CARD_CLASS =
  "rounded-[14px] border border-thread-border bg-[var(--thread-code-bg)] p-3 font-mono text-[11px] text-thread-text-secondary";
const LABEL_CLASS = "mb-2 text-[10px] text-thread-text-muted";
const BUTTON_CLASS =
  "rounded-full border border-thread-border px-3 py-1 text-[11px] text-thread-text-primary transition-colors hover:bg-thread-hover disabled:cursor-not-allowed disabled:opacity-40";
const LINK_CLASS =
  "mt-2 inline-block text-[11px] text-thread-accent underline-offset-4 hover:underline";

function useApprovalDecision(runId: string, approvalId: string) {
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: (decision: ApprovalChoice) =>
      decideRunApproval(getToken, runId, approvalId, { decision }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Approval decision failed"),
  });
}

export function ApprovalRequestBlock({
  data,
  resolved,
}: {
  data: ApprovalRequestData;
  resolved: boolean;
}) {
  const decision = useApprovalDecision(data.runId, data.approvalId);
  const expired = Date.now() > data.expiresAt;
  const disabled = resolved || expired || decision.isPending;
  if (data.kind === "model-fallback") {
    return <ModelFallbackApprovalCard data={data} disabled={disabled} onDecide={decision.mutate} />;
  }
  return <ToolApprovalCard data={data} disabled={disabled} onDecide={decision.mutate} />;
}

function ToolApprovalCard({
  data,
  disabled,
  onDecide,
}: {
  data: ApprovalRequestData;
  disabled: boolean;
  onDecide: (decision: ApprovalChoice) => void;
}) {
  return (
    <div className={CARD_CLASS}>
      <div className={LABEL_CLASS}>approval required</div>
      <div className="text-thread-text-primary">{data.toolName ?? "tool"}</div>
      <pre className="mt-1 whitespace-pre-wrap break-words rounded-[10px] bg-white p-2 text-thread-text-secondary">
        <code>{data.summary}</code>
      </pre>
      <DecisionButtons
        allowLabel="Allow"
        denyLabel="Deny"
        disabled={disabled}
        onDecide={onDecide}
      />
    </div>
  );
}

function ModelFallbackApprovalCard({
  data,
  disabled,
  onDecide,
}: {
  data: ApprovalRequestData;
  disabled: boolean;
  onDecide: (decision: ApprovalChoice) => void;
}) {
  return (
    <div className={CARD_CLASS}>
      <div className={LABEL_CLASS}>model fallback</div>
      <div className="text-thread-text-primary">{data.summary}</div>
      <div className="mt-1 text-[10px] text-thread-text-muted">
        Auto-continues with the fallback model if no response.
      </div>
      <DecisionButtons
        allowLabel="Use fallback"
        denyLabel="Deny"
        disabled={disabled}
        onDecide={onDecide}
      />
      <Link className={LINK_CLASS} href="/settings/api-keys">
        Open Models &amp; Keys
      </Link>
    </div>
  );
}

function DecisionButtons({
  allowLabel,
  denyLabel,
  disabled,
  onDecide,
}: {
  allowLabel: string;
  denyLabel: string;
  disabled: boolean;
  onDecide: (decision: ApprovalChoice) => void;
}) {
  return (
    <div className="mt-2 flex gap-2">
      <button
        className={BUTTON_CLASS}
        disabled={disabled}
        onClick={() => onDecide("allow")}
        type="button"
      >
        {allowLabel}
      </button>
      <button
        className={BUTTON_CLASS}
        disabled={disabled}
        onClick={() => onDecide("deny")}
        type="button"
      >
        {denyLabel}
      </button>
    </div>
  );
}

export function ApprovalDecisionBlock({ data }: { data: ApprovalDecisionData }) {
  return (
    <div className={CARD_CLASS}>
      <div className={LABEL_CLASS}>decision</div>
      <div className="text-thread-text-primary">{decisionLabel(data)}</div>
    </div>
  );
}

/** Informational model-transition notice (the interactive pause is an approval-request). */
export function ModelFallbackBlock({ data }: { data: ModelFallbackData }) {
  return (
    <div className={CARD_CLASS}>
      <div className={LABEL_CLASS}>model fallback</div>
      <div className="text-thread-text-primary">
        Switched from {data.fromModel} to {data.toModel}
      </div>
      <div className="mt-1 text-[10px] text-thread-text-muted">
        Reason: {fallbackReasonLabel(data.reason)}
      </div>
      <Link className={LINK_CLASS} href="/settings/api-keys">
        Open Models &amp; Keys
      </Link>
    </div>
  );
}

function decisionLabel(data: ApprovalDecisionData): string {
  const verb = data.decision === "allow" ? "allowed" : "denied";
  if (data.decidedBy === "user") {
    return `${verb} by user`;
  }
  return `${verb} (${data.decidedBy})`;
}

function fallbackReasonLabel(reason: ModelFallbackData["reason"]): string {
  if (reason === "rate_limit") {
    return "provider rate limit";
  }
  if (reason === "credits") {
    return "out of credits";
  }
  return "provider error";
}
