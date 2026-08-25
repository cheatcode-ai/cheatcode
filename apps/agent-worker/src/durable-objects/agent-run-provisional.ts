import type { UIMessageChunk } from "ai";

const PROVISIONAL_BATCH_MAX_CHARACTERS = 4_096;
const PROVISIONAL_BATCH_MAX_DELAY_MS = 80;

export function provisionalModelResetChunk(): UIMessageChunk {
  return {
    data: { phase: "reset", v: 1 },
    transient: true,
    type: "data-model-provisional",
  } as UIMessageChunk;
}

/** Batches provider tokens into bounded, replayable Durable Object events. */
export class ProvisionalModelBatcher {
  private batchIndex = 0;
  private buffer = "";
  private lastFlushAt = 0;

  public constructor(
    private readonly streamId: string,
    private readonly append: (eventKey: string, chunk: UIMessageChunk) => Promise<void>,
  ) {}

  public async push(delta: string): Promise<void> {
    if (delta.length === 0) return;
    this.buffer += delta;
    const now = Date.now();
    if (
      this.batchIndex === 0 ||
      this.buffer.length >= PROVISIONAL_BATCH_MAX_CHARACTERS ||
      now - this.lastFlushAt >= PROVISIONAL_BATCH_MAX_DELAY_MS
    ) {
      await this.flush();
    }
  }

  public async flush(): Promise<void> {
    while (this.buffer.length > 0) {
      const end = safeSliceEnd(this.buffer, PROVISIONAL_BATCH_MAX_CHARACTERS);
      const delta = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      const batchIndex = this.batchIndex;
      this.batchIndex += 1;
      this.lastFlushAt = Date.now();
      await this.append(`model-provisional:${this.streamId}:${batchIndex}`, {
        data: { delta, phase: "delta", streamId: this.streamId, v: 1 },
        transient: true,
        type: "data-model-provisional",
      } as UIMessageChunk);
    }
  }
}

function safeSliceEnd(value: string, maxCharacters: number): number {
  const candidate = Math.min(value.length, maxCharacters);
  if (candidate === value.length) return candidate;
  const previous = value.charCodeAt(candidate - 1);
  const next = value.charCodeAt(candidate);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? candidate - 1
    : candidate;
}
