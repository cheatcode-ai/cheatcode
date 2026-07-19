import { isToolPart } from "@/components/chat/message-activity";
import type { MessagePart, TimelineItem } from "@/components/chat/message-parts.types";

interface PendingActivity {
  parts: MessagePart[];
  startIndex: number;
}

/** Groups working steps while leaving the settled answer and interactive parts inline. */
export function buildMessageTimeline(
  messageId: string,
  parts: readonly MessagePart[],
  streaming: boolean,
): TimelineItem[] {
  const finalAnswerIndex = streaming ? -1 : lastAnswerTextIndex(parts);
  const items: TimelineItem[] = [];
  const deferredSkillProposals: TimelineItem[] = [];
  let activity: PendingActivity | null = null;
  const flushActivity = () => {
    if (!activity) return;
    items.push({
      key: `${messageId}:activity:${activity.startIndex}`,
      kind: "activity",
      parts: activity.parts,
    });
    activity = null;
  };
  parts.forEach((part, index) => {
    if (isHiddenTranscriptPart(part)) return;
    if (part.type === "data-skill-proposed") {
      flushActivity();
      deferredSkillProposals.push({
        key: partKey(messageId, part, index),
        kind: "part",
        part,
      });
      return;
    }
    if (index === finalAnswerIndex || !isStepPart(part)) {
      flushActivity();
      items.push({ key: partKey(messageId, part, index), kind: "part", part });
      return;
    }
    activity ??= { parts: [], startIndex: index };
    activity.parts.push(part);
  });
  flushActivity();
  return [...items, ...deferredSkillProposals];
}

export function isHiddenTranscriptPart(part: MessagePart): boolean {
  return (
    part.type === "data-artifact" ||
    part.type === "data-sandbox-status" ||
    part.type === "data-plan" ||
    part.type === "data-task-status" ||
    part.type === "data-transcript-fragment"
  );
}

export function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function lastAnswerTextIndex(parts: readonly MessagePart[]): number {
  const trailing = trailingTextIndex(parts);
  return trailing === -1 ? lastNonEmptyTextIndex(parts) : trailing;
}

function trailingTextIndex(parts: readonly MessagePart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (isNonEmptyText(part)) return index;
    if (part && isToolPart(part)) return -1;
  }
  return -1;
}

function lastNonEmptyTextIndex(parts: readonly MessagePart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isNonEmptyText(parts[index])) return index;
  }
  return -1;
}

function isNonEmptyText(
  part: MessagePart | undefined,
): part is Extract<MessagePart, { type: "text" }> {
  return part?.type === "text" && part.text.trim().length > 0;
}

function isStepPart(part: MessagePart): boolean {
  return part.type === "text" || part.type === "data-project-created" || isToolPart(part);
}

function partKey(messageId: string, part: MessagePart, partIndex: number): string {
  if (part.type === "text") return `${messageId}:${partIndex}:text:${part.text.slice(0, 80)}`;
  if (part.type === "data-artifact") {
    return `${messageId}:${partIndex}:artifact:${part.data.outputId}`;
  }
  if (isToolPart(part)) return toolPartKey(messageId, part, partIndex);
  return `${messageId}:${partIndex}:${part.type}:${formatUnknown(part).slice(0, 120)}`;
}

function toolPartKey(
  messageId: string,
  part: Extract<MessagePart, { type: "data-tool" }>,
  partIndex: number,
): string {
  return `${messageId}:${partIndex}:${part.type}:${part.data.toolCallId}`;
}
