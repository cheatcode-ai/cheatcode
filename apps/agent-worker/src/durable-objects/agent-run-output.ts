import type { UIMessageChunk } from "ai";
import {
  createSeqChunk,
  isMessagePartRow,
  type MessagePartRow,
  parseSequencedChunk,
} from "../streaming/ui-message-stream";
import { emitRunAbandoned } from "./agent-run-abandonment";
import type { AgentRunEnv } from "./agent-run-env";
import { emitFirstVisibleChunkMetric } from "./agent-run-performance";
import { appendAgentRunMessagePart } from "./agent-run-storage";
import { mastraChunkToUiChunks } from "./mastra-stream-chunks";
import { hasActiveRun } from "./run-state";

const STREAM_REPLAY_PAGE_SIZE = 100;
const STREAM_SUBSCRIBER_HIGH_WATER_MARK = 256;
const ANSWER_SEGMENT_BREAK_TYPES = new Set<string>(["data-tool", "data-thinking"]);

type Subscriber = { controller: ReadableStreamDefaultController<UIMessageChunk> };

interface ResumeStreamState {
  cursor: number;
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
  private answerSegmentCount = 0;
  private lastVisibleWasAnswerText = false;
  private openAnswerSegmentId: string | null = null;
  private sawArtifact = false;
  private readonly subscribers = new Set<Subscriber>();

  public constructor(private readonly options: AgentRunOutputOptions) {}

  public resetAnswerState(): void {
    this.openAnswerSegmentId = null;
    this.answerSegmentCount = 0;
    this.lastVisibleWasAnswerText = false;
    this.sawArtifact = false;
  }

  public resume(lastSeq: number): ReadableStream<UIMessageChunk> {
    const state: ResumeStreamState = {
      cursor: lastSeq,
      pendingRows: [],
      subscriber: undefined,
    };
    return new ReadableStream<UIMessageChunk>(
      {
        pull: (controller) => this.pullResumeStream(controller, state),
        cancel: () => this.cancelResumeStream(state),
      },
      { highWaterMark: STREAM_SUBSCRIBER_HIGH_WATER_MARK },
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
    const rows: unknown[] = this.options.ctx.storage.sql
      .exec(
        "SELECT seq, payload_json FROM message_part WHERE seq > ? ORDER BY seq LIMIT ?",
        lastSeq,
        STREAM_REPLAY_PAGE_SIZE,
      )
      .toArray();
    return rows.filter(isMessagePartRow);
  }

  public async appendMastraChunk(chunk: unknown): Promise<number> {
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

  public async ensureAnswerSegmentEnded(): Promise<number> {
    if (this.openAnswerSegmentId === null) {
      return 0;
    }
    const id = this.openAnswerSegmentId;
    this.openAnswerSegmentId = null;
    await this.append({ type: "text-end", id });
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
    const sequencedChunk = {
      chunk,
      seq: appendAgentRunMessagePart(this.options.ctx, chunk),
    };
    emitFirstVisibleChunkMetric(this.options.ctx, this.options.env, chunk);
    for (const subscriber of [...this.subscribers]) {
      if ((subscriber.controller.desiredSize ?? 1) <= 0) {
        this.subscribers.delete(subscriber);
        subscriber.controller.error(new Error("Agent stream subscriber fell behind."));
        continue;
      }
      this.write(subscriber.controller, sequencedChunk);
    }
  }

  public closeSubscribers(): void {
    for (const subscriber of this.subscribers) {
      subscriber.controller.close();
      this.subscribers.delete(subscriber);
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
      controller.close();
      return;
    }
    const subscriber = { controller };
    state.subscriber = subscriber;
    this.subscribers.add(subscriber);
  }

  private cancelResumeStream(state: ResumeStreamState): void {
    if (!state.subscriber) {
      return;
    }
    this.subscribers.delete(state.subscriber);
    state.subscriber = undefined;
    if (this.subscribers.size === 0) {
      emitRunAbandoned(this.options.ctx, this.options.env);
    }
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
