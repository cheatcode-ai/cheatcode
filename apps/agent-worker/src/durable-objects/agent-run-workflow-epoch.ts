import {
  AGENT_RUN_EXECUTION_EPOCH_MS,
  AGENT_RUN_EXECUTION_HEARTBEAT_MS,
  type AgentRunWorkflowEpochResult,
} from "./agent-run-workflow-protocol";

interface ExecutionEpochOptions {
  getStatus: () => string | undefined;
  isDeleted: () => boolean;
  runPromise: Promise<void>;
}

/** Keeps the Workflow-to-DO caller attached, then yields so Workflow can checkpoint ownership. */
export function agentRunExecutionEpochResponse(options: ExecutionEpochOptions): Response {
  const encoder = new TextEncoder();
  let cancelStream = (): void => undefined;
  const stream = new ReadableStream<Uint8Array>({
    cancel: () => cancelStream(),
    start(controller) {
      let isClosed = false;
      const heartbeat = setInterval(() => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(" "));
        } catch {
          cleanup();
        }
      }, AGENT_RUN_EXECUTION_HEARTBEAT_MS);
      const epoch = setTimeout(() => finish("continue"), AGENT_RUN_EXECUTION_EPOCH_MS);

      const cleanup = (): void => {
        if (isClosed) return;
        isClosed = true;
        clearInterval(heartbeat);
        clearTimeout(epoch);
      };
      const finish = (outcome: AgentRunWorkflowEpochResult["outcome"]): void => {
        if (isClosed) return;
        try {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                outcome,
                status: options.getStatus() ?? "unknown",
              } satisfies AgentRunWorkflowEpochResult),
            ),
          );
          cleanup();
          controller.close();
        } catch {
          cleanup();
        }
      };
      cancelStream = cleanup;
      void options.runPromise.then(
        () => finish(options.isDeleted() ? "deleted" : "terminal"),
        (error: unknown) => {
          if (isClosed) return;
          cleanup();
          try {
            controller.error(error);
          } catch {
            // The Workflow caller can cancel between promise settlement and delivery.
          }
        },
      );
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
