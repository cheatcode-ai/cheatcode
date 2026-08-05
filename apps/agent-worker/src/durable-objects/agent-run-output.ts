import type { UIMessageChunk } from "ai";
import {
  createSeqChunk,
  type MessagePartRow,
  parseSequencedChunk,
} from "../streaming/ui-message-stream";
import { emitRunAbandoned } from "./agent-run-abandonment";
import type { AgentRunEnv } from "./agent-run-env";
import { emitFirstVisibleChunkMetric } from "./agent-run-performance";
import {
  appendAgentRunMessagePart,
  appendAgentRunMessagePartOnce,
  readAgentRunMessagePartPage,
} from "./agent-run-storage";
import { boundedAgentRunChunks, serializedChunkBytes } from "./agent-run-transcript-chunks";
import { hasActiveRun } from "./run-state";

const MAX_ACTIVE_STREAMS = 8;
const STREAM_SUBSCRIBER_HIGH_WATER_MARK_BYTES = 256 * 1024;
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
  private readonly subscribers = new Set<Subscriber>();

  public constructor(private readonly options: AgentRunOutputOptions) {}

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

  /** Publishes a checkpointed Workflow event exactly once, including bounded fragments. */
  public appendWorkflowEvent(eventKey: string, chunks: readonly UIMessageChunk[]): number {
    let appendedCount = 0;
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const fragmentId = `${eventKey}-${chunkIndex}`;
      let fragmentIndex = 0;
      for (const bounded of boundedAgentRunChunks(chunk, fragmentId)) {
        const seq = appendAgentRunMessagePartOnce(
          this.options.ctx,
          `${eventKey}:${chunkIndex}:${fragmentIndex}`,
          bounded,
        );
        fragmentIndex += 1;
        if (seq !== null) {
          this.broadcast(bounded, seq);
          appendedCount += 1;
        }
      }
    }
    return appendedCount;
  }

  public async append(
    chunk: UIMessageChunk,
    options?: { allowAfterCancelRequest?: boolean },
  ): Promise<void> {
    if (this.options.isCanceled() && !options?.allowAfterCancelRequest) {
      return;
    }
    const fragmentId = `event-${crypto.randomUUID()}`;
    for (const bounded of boundedAgentRunChunks(chunk, fragmentId)) {
      this.appendBounded(bounded);
    }
  }

  private appendBounded(chunk: UIMessageChunk): void {
    this.broadcast(chunk, appendAgentRunMessagePart(this.options.ctx, chunk));
  }

  private broadcast(chunk: UIMessageChunk, seq: number): void {
    const sequencedChunk = { chunk, seq };
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

  private write(
    controller: ReadableStreamDefaultController<UIMessageChunk>,
    sequencedChunk: { chunk: UIMessageChunk; seq: number },
  ): void {
    controller.enqueue(sequencedChunk.chunk);
    controller.enqueue(createSeqChunk(sequencedChunk.seq));
  }
}
