/**
 * Approval broker contract — the request-scoped channel through which the
 * AgentRun DO gates sensitive tool calls (and interactive model fallback)
 * behind a user Allow/Deny decision.
 *
 * The broker is injected into the Mastra `RequestContext` under
 * {@link APPROVAL_BROKER_CONTEXT_KEY} (same channel as `codeRuntime` / BYOK
 * keys). A gated tool's `execute` reads it and awaits `requestDecision(...)`
 * in-process while the Mastra stream stays open; the DO closure pauses the run,
 * persists the pending approval, and resolves the promise on the user decision,
 * the timeout alarm, or a cancellation.
 *
 * This module is the CONTRACT only — the gate wrapper (`withApprovalGate`), the
 * static policy table, and the DO-side broker factory live in their own
 * follow-up modules. Keeping the key + types here lets both the producer (DO)
 * and the consumers (tools) depend on one shared definition.
 */

/** Request-context key carrying the per-run {@link ApprovalBroker}. */
export const APPROVAL_BROKER_CONTEXT_KEY = "approvalBroker";

/** What is being gated: a destructive tool call or an interactive model fallback. */
export type ApprovalKind = "tool-approval" | "model-fallback";

/** Allow/Deny outcome of an approval decision. */
export type ApprovalDecisionValue = "allow" | "deny";

/** Who/what resolved an approval: the user, the timeout alarm, or a cancellation. */
export type ApprovalDecidedBy = "user" | "timeout" | "cancel";

/**
 * Input the gated tool (or fallback flow) hands to the broker. `summary` is the
 * human-readable, displayable string (e.g. the exact shell command);
 * `argsPreview` is an optional truncated JSON of the tool input retained for the
 * DO's own records. `timeoutMs` + `timeoutDecision` tell the DO how long to wait
 * and what to apply if the deadline passes with no user decision.
 */
export interface ApprovalRequestInput {
  kind: ApprovalKind;
  toolName?: string;
  toolCallId?: string;
  summary: string;
  argsPreview?: string;
  timeoutMs: number;
  timeoutDecision: ApprovalDecisionValue;
}

/** Resolved decision returned by the broker to the awaiting tool/flow. */
export interface RunDecision {
  decision: ApprovalDecisionValue;
  decidedBy: ApprovalDecidedBy;
  reason?: string;
}

/**
 * Per-run approval broker. Created by the AgentRun DO and passed request-scoped
 * via the Mastra `RequestContext`. `requestDecision` serializes concurrent
 * gated calls, persists the pending state, emits the `approval-request` stream
 * part, flips the run to `paused`, and resolves once a decision lands.
 */
export interface ApprovalBroker {
  requestDecision(input: ApprovalRequestInput): Promise<RunDecision>;
}
