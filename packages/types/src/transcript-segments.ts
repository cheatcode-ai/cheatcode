import {
  type CheatcodeUIMessage,
  MessagePartSchema,
  TRANSCRIPT_FRAGMENT_PAYLOAD_MAX_CHARACTERS,
  type UIMessagePart,
} from "./ui-message";

export const TRANSCRIPT_SEGMENT_MAX_PARTS_BYTES = 128 * 1024;

export interface TranscriptSegmentParts {
  index: number;
  isFinal: boolean;
  parts: readonly UIMessagePart[];
}

/** Returns null until every segment from zero through the final marker is present. */
export function coalesceTranscriptSegmentParts(
  segments: readonly TranscriptSegmentParts[],
): CheatcodeUIMessage["parts"] | null {
  const ordered = completeOrderedSegments(segments);
  if (!ordered) {
    return null;
  }
  return reassembleParts(ordered.flatMap((segment) => segment.parts));
}

/** Coalesces every fully loaded persisted run into one stable assistant message. */
export function coalesceTranscriptUIMessages(
  messages: readonly CheatcodeUIMessage[],
): CheatcodeUIMessage[] {
  const groups = transcriptMessageGroups(messages);
  const emitted = new Set<string>();
  const output: CheatcodeUIMessage[] = [];
  for (const message of messages) {
    const segment = message.metadata?.transcriptSegment;
    if (message.role !== "assistant" || !segment) {
      output.push(message);
      continue;
    }
    const runId = segment.agentRunId;
    if (emitted.has(runId)) {
      continue;
    }
    emitted.add(runId);
    const group = groups.get(runId) ?? [];
    const parts = coalesceTranscriptSegmentParts(group);
    const first = group.find((value) => value.index === 0);
    if (parts && first) {
      output.push({
        ...first.message,
        id: runId,
        metadata: {
          ...first.message.metadata,
          transcriptSegment: { agentRunId: segment.agentRunId, index: 0, isFinal: true },
        },
        parts,
      });
    }
  }
  return output;
}

export function hasIncompleteTranscriptUIMessages(
  messages: readonly CheatcodeUIMessage[],
): boolean {
  for (const group of transcriptMessageGroups(messages).values()) {
    if (coalesceTranscriptSegmentParts(group) === null) {
      return true;
    }
  }
  return false;
}

/** Hides an in-flight fragment tail and replaces a complete fragment group losslessly. */
export function reconstructedTranscriptUIMessage(message: CheatcodeUIMessage): CheatcodeUIMessage {
  if (!message.parts.some((part) => part.type === "data-transcript-fragment")) {
    return message;
  }
  return {
    ...message,
    parts: reassembleVisibleParts(message.parts),
  };
}

export function* fragmentMessagePart(
  part: UIMessagePart,
  partId: string,
): Generator<UIMessagePart, void> {
  const payload = JSON.stringify(part);
  let offset = 0;
  let index = 0;
  while (offset < payload.length) {
    const end = safeSliceEnd(payload, offset, TRANSCRIPT_FRAGMENT_PAYLOAD_MAX_CHARACTERS);
    yield {
      data: {
        v: 1,
        final: end === payload.length,
        index,
        partId,
        payload: payload.slice(offset, end),
      },
      type: "data-transcript-fragment",
    };
    index += 1;
    offset = end;
  }
}

export function serializedMessagePartsBytes(parts: readonly UIMessagePart[]): number {
  return new TextEncoder().encode(JSON.stringify(parts)).byteLength;
}

function completeOrderedSegments(
  segments: readonly TranscriptSegmentParts[],
): TranscriptSegmentParts[] | null {
  const byIndex = new Map<number, TranscriptSegmentParts>();
  let finalIndex: number | null = null;
  for (const segment of segments) {
    if (byIndex.has(segment.index) || segment.index < 0 || !Number.isSafeInteger(segment.index)) {
      return null;
    }
    byIndex.set(segment.index, segment);
    if (segment.isFinal) {
      if (finalIndex !== null) {
        return null;
      }
      finalIndex = segment.index;
    }
  }
  if (finalIndex === null || byIndex.size !== finalIndex + 1) {
    return null;
  }
  const ordered: TranscriptSegmentParts[] = [];
  for (let index = 0; index <= finalIndex; index += 1) {
    const segment = byIndex.get(index);
    if (!segment) {
      return null;
    }
    ordered.push(segment);
  }
  return ordered;
}

interface TranscriptMessageSegment extends TranscriptSegmentParts {
  message: CheatcodeUIMessage;
}

function transcriptMessageGroups(
  messages: readonly CheatcodeUIMessage[],
): Map<string, TranscriptMessageSegment[]> {
  const groups = new Map<string, TranscriptMessageSegment[]>();
  for (const message of messages) {
    const segment = message.metadata?.transcriptSegment;
    if (message.role !== "assistant" || !segment) {
      continue;
    }
    const group = groups.get(segment.agentRunId) ?? [];
    group.push({
      index: segment.index,
      isFinal: segment.isFinal,
      message,
      parts: message.parts,
    });
    groups.set(segment.agentRunId, group);
  }
  return groups;
}

function reassembleParts(parts: readonly UIMessagePart[]): CheatcodeUIMessage["parts"] | null {
  const output: CheatcodeUIMessage["parts"] = [];
  for (let index = 0; index < parts.length; ) {
    const part = parts[index];
    if (!part) {
      return null;
    }
    if (part.type !== "data-transcript-fragment") {
      if (!appendValidatedPart(output, part)) {
        return null;
      }
      index += 1;
      continue;
    }
    const assembled = assembleFragmentedPart(parts, index);
    if (!assembled || !appendValidatedPart(output, assembled.part)) {
      return null;
    }
    index = assembled.nextIndex;
  }
  return output;
}

function reassembleVisibleParts(parts: readonly UIMessagePart[]): CheatcodeUIMessage["parts"] {
  const output: CheatcodeUIMessage["parts"] = [];
  for (let index = 0; index < parts.length; ) {
    const part = parts[index];
    if (!part) {
      break;
    }
    if (part.type !== "data-transcript-fragment") {
      appendValidatedPart(output, part);
      index += 1;
      continue;
    }
    const assembled = assembleFragmentedPart(parts, index);
    if (assembled && appendValidatedPart(output, assembled.part)) {
      index = assembled.nextIndex;
      continue;
    }
    index = nextFragmentGroupOrPart(parts, index + 1);
  }
  return output;
}

function nextFragmentGroupOrPart(parts: readonly UIMessagePart[], startIndex: number): number {
  let index = startIndex;
  while (index < parts.length) {
    const part = parts[index];
    if (part?.type !== "data-transcript-fragment" || fragmentData(part)?.index === 0) {
      break;
    }
    index += 1;
  }
  return index;
}

function assembleFragmentedPart(
  parts: readonly UIMessagePart[],
  startIndex: number,
): { nextIndex: number; part: unknown } | null {
  const first = fragmentData(parts[startIndex]);
  if (first?.index !== 0) {
    return null;
  }
  const payload: string[] = [];
  let index = startIndex;
  for (;;) {
    const fragment = fragmentData(parts[index]);
    if (!fragment || fragment.partId !== first.partId || fragment.index !== payload.length) {
      return null;
    }
    payload.push(fragment.payload);
    index += 1;
    if (fragment.final) {
      try {
        return { nextIndex: index, part: JSON.parse(payload.join("")) };
      } catch {
        return null;
      }
    }
  }
}

function fragmentData(part: UIMessagePart | undefined) {
  if (part?.type !== "data-transcript-fragment") {
    return null;
  }
  const parsed = MessagePartSchema.safeParse(part);
  return parsed.success && parsed.data.type === "data-transcript-fragment"
    ? parsed.data.data
    : null;
}

function appendValidatedPart(output: CheatcodeUIMessage["parts"], value: unknown): boolean {
  const parsed = MessagePartSchema.safeParse(value);
  if (!parsed.success || parsed.data.type === "data-transcript-fragment") {
    return false;
  }
  const previous = output.at(-1);
  if (previous?.type === "text" && parsed.data.type === "text") {
    previous["text"] = `${String(previous["text"])}${parsed.data.text}`;
    previous["state"] = "done";
    return true;
  }
  output.push(parsed.data as CheatcodeUIMessage["parts"][number]);
  return true;
}

function safeSliceEnd(value: string, offset: number, maxCharacters: number): number {
  const candidate = Math.min(value.length, offset + maxCharacters);
  if (candidate === value.length) {
    return candidate;
  }
  const previous = value.charCodeAt(candidate - 1);
  const next = value.charCodeAt(candidate);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? candidate - 1
    : candidate;
}
