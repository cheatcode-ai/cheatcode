import type { AgentChunkType } from "@cheatcode/agent-core";
import type { UIMessageChunk } from "ai";
import {
  createSeqChunk,
  type MessagePartRow,
  parseSequencedChunk,
} from "../streaming/ui-message-stream";
import { emitRunAbandoned } from "./agent-run-abandonment";
import type { AgentRunEnv } from "./agent-run-env";
import { emitFirstVisibleChunkMetric } from "./agent-run-performance";
import { appendAgentRunMessagePart, readAgentRunMessagePartPage } from "./agent-run-storage";
import { boundedAgentRunChunks, serializedChunkBytes } from "./agent-run-transcript-chunks";
import { mastraChunkToUiChunks } from "./mastra-stream-chunks";
import { hasActiveRun } from "./run-state";

const MAX_ACTIVE_STREAMS = 8;
const STREAM_SUBSCRIBER_HIGH_WATER_MARK_BYTES = 256 * 1024;
const ANSWER_SEGMENT_BREAK_TYPES = new Set<string>(["data-tool"]);

type Subscriber = {
  controller: ReadableStreamDefaultController<UIMessageChunk>;
  release: () => void;
};

interface ResumeStreamState {
  cursor: number;
  isReleased: boolean;
  pendingRows: MessagePartRow[];
  subscriber: Subscriber | undefined;
}

interface AgentRunOutputOptions {
  ctx: DurableObjectState;
  env: AgentRunEnv;
  getStatus: () => string | undefined;
  isCanceled: () => boolean;
  isTerminalizing: () => boolean;
}

export class AgentRunOutput {
  private activeStreamCount = 0;
  private answerSegmentCount = 0;
  private lastVisibleWasAnswerText = false;
  private nextOutputEvent = 0;
  private openAnswerSegmentId: string | null = null;
  private sawArtifact = false;
  private readonly subscribers = new Set<Subscriber>();

  public constructor(private readonly options: AgentRunOutputOptions) {}

  public resetAnswerState(): void {
    this.openAnswerSegmentId = null;
    this.answerSegmentCount = 0;
    this.lastVisibleWasAnswerText = false;
    this.nextOutputEvent = 0;
    this.sawArtifact = false;
  }

  public hasStreamCapacity(): boolean {
    return this.activeStreamCount < MAX_ACTIVE_STREAMS;
  }

  public resume(lastSeq: number): ReadableStream<UIMessageChunk> | null {
    if (!this.hasStreamCapacity()) {
      return null;
    }
    this.activeStreamCount += 1;
    const state: ResumeStreamState = {
      cursor: lastSeq,
      isReleased: false,
      pendingRows: [],
      subscriber: undefined,
    };
    return new ReadableStream<UIMessageChunk>(
      {
        pull: (controller) => this.pullResumeStreamSafely(controller, state),
        cancel: () => this.cancelResumeStream(state),
      },
      {
        highWaterMark: STREAM_SUBSCRIBER_HIGH_WATER_MARK_BYTES,
        size: serializedChunkBytes,
      },
    );
  }

  public hasReplayRows(lastSeq: number): boolean {
    return (
      this.options.ctx.storage.sql
        .exec("SELECT seq FROM message_part WHERE seq > ? ORDER BY seq LIMIT 1", lastSeq)
        .toArray().length > 0
    );
  }

  private replayRowsPage(lastSeq: number): MessagePartRow[] {
    return readAgentRunMessagePartPage(this.options.ctx, lastSeq);
  }

  public async appendMastraChunk(chunk: AgentChunkType): Promise<number> {
    let appendedCount = 0;
    for (const uiChunk of mastraChunkToUiChunks(chunk)) {
      appendedCount += await this.appendAnswerSegmented(uiChunk);
    }
    return appendedCount;
  }

  public async appendClosingBackstop(): Promise<void> {
    if (this.lastVisibleWasAnswerText) {
      return;
    }
    const closing = this.sawArtifact
      ? "Done — your file is ready to download from the deliverables above. Let me know if you'd like any changes."
      : "Done — I've finished the work; you can review it in the Computer panel. Let me know if you'd like any changes.";
    await this.appendAnswerSegmented({ type: "text-delta", id: "answer", delta: closing });
  }

  public async ensureAnswerSegmentEnded(options?: {
    allowAfterCancelRequest?: boolean;
  }): Promise<number> {
    if (this.openAnswerSegmentId === null) {
      return 0;
    }
    const id = this.openAnswerSegmentId;
    this.openAnswerSegmentId = null;
    await this.append({ type: "text-end", id }, options);
    return 1;
  }

  public async append(
    chunk: UIMessageChunk,
    options?: { allowAfterCancelRequest?: boolean },
  ): Promise<void> {
    if (this.options.isCanceled() && !options?.allowAfterCancelRequest) {
      return;
    }
    this.trackClosingSignals(chunk);
    const fragmentId = `event-${this.nextOutputEvent}`;
    this.nextOutputEvent += 1;
    for (const bounded of boundedAgentRunChunks(chunk, fragmentId)) {
      this.appendBounded(bounded);
    }
  }

  private appendBounded(chunk: UIMessageChunk): void {
    const sequencedChunk = {
      chunk,
      seq: appendAgentRunMessagePart(this.options.ctx, chunk),
    };
    emitFirstVisibleChunkMetric(this.options.ctx, this.options.env, chunk);
    for (const subscriber of [...this.subscribers]) {
      if ((subscriber.controller.desiredSize ?? 1) <= 0) {
        this.errorSubscriber(subscriber, new Error("Agent stream subscriber fell behind."));
        continue;
      }
      try {
        this.write(subscriber.controller, sequencedChunk);
      } catch (error) {
        this.errorSubscriber(subscriber, error);
      }
    }
  }

  public closeSubscribers(): void {
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber.controller.close();
      } catch {
        // A canceled stream may close between snapshotting and termination.
      } finally {
        this.releaseSubscriber(subscriber);
      }
    }
  }

  private pullResumeStreamSafely(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    state: ResumeStreamState,
  ): void {
    try {
      this.pullResumeStream(controller, state);
    } catch (error) {
      this.releaseStream(state);
      try {
        controller.error(error);
      } catch {
        // The consumer may have canceled while replay storage was being read.
      }
    }
  }

  private pullResumeStream(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    state: ResumeStreamState,
  ): void {
    if (state.subscriber) {
      return;
    }
    while ((controller.desiredSize ?? 1) > 0) {
      const row = this.nextReplayRow(state);
      if (!row) {
        this.attachLiveSubscriberOrClose(controller, state);
        return;
      }
      const sequenced = parseSequencedChunk(row);
      state.cursor = sequenced.seq;
      this.write(controller, sequenced);
    }
  }

  private nextReplayRow(state: ResumeStreamState): MessagePartRow | null {
    if (state.pendingRows.length === 0) {
      state.pendingRows = this.replayRowsPage(state.cursor);
    }
    return state.pendingRows.shift() ?? null;
  }

  private attachLiveSubscriberOrClose(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    state: ResumeStreamState,
  ): void {
    if (!hasActiveRun(this.options.getStatus()) && !this.options.isTerminalizing()) {
      this.releaseStream(state);
      try {
        controller.close();
      } catch {
        // A terminal stream can race with consumer cancellation.
      }
      return;
    }
    const subscriber: Subscriber = {
      controller,
      release: () => {
        if (state.subscriber === subscriber) {
          state.subscriber = undefined;
        }
        this.releaseStream(state);
      },
    };
    state.subscriber = subscriber;
    this.subscribers.add(subscriber);
  }

  private cancelResumeStream(state: ResumeStreamState): void {
    const subscriber = state.subscriber;
    if (subscriber) {
      this.subscribers.delete(subscriber);
      state.subscriber = undefined;
    }
    this.releaseStream(state);
    if (subscriber && this.subscribers.size === 0) {
      emitRunAbandoned(this.options.ctx, this.options.env);
    }
  }

  private releaseSubscriber(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
    subscriber.release();
  }

  private errorSubscriber(subscriber: Subscriber, error: unknown): void {
    try {
      subscriber.controller.error(error);
    } catch {
      // Controller termination is best-effort; the stream slot must still be released.
    } finally {
      this.releaseSubscriber(subscriber);
    }
  }

  private releaseStream(state: ResumeStreamState): void {
    if (state.isReleased) {
      return;
    }
    state.isReleased = true;
    this.activeStreamCount = Math.max(0, this.activeStreamCount - 1);
  }

  private async appendAnswerSegmented(uiChunk: UIMessageChunk): Promise<number> {
    if (uiChunk.type === "text-delta") {
      this.lastVisibleWasAnswerText = true;
      let count = 0;
      if (this.openAnswerSegmentId === null) {
        this.openAnswerSegmentId = `answer-${this.answerSegmentCount}`;
        this.answerSegmentCount += 1;
        await this.append({ type: "text-start", id: this.openAnswerSegmentId });
        count += 1;
      }
      await this.append({ ...uiChunk, id: this.openAnswerSegmentId });
      return count + 1;
    }
    if (ANSWER_SEGMENT_BREAK_TYPES.has(uiChunk.type)) {
      this.lastVisibleWasAnswerText = false;
      const closed = await this.ensureAnswerSegmentEnded();
      await this.append(uiChunk);
      return closed + 1;
    }
    await this.append(uiChunk);
    return 1;
  }

  private trackClosingSignals(uiChunk: UIMessageChunk): void {
    if (uiChunk.type === "data-artifact") {
      this.sawArtifact = true;
    }
  }

  private write(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    sequencedChunk: { chunk: UIMessageChunk; seq: number },
  ): void {
    controller.enqueue(sequencedChunk.chunk);
    controller.enqueue(createSeqChunk(sequencedChunk.seq));
  }
}
