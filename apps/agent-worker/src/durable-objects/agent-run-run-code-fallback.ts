import { createSandboxReadinessRunCodeInput, executeRunCodeTool } from "@cheatcode/agent-core";
import type { createLogger } from "@cheatcode/observability";
import type { CodeRuntimeContext } from "@cheatcode/tools-code";
import type { UIMessageChunk } from "ai";
import type { StartRunInput } from "./agent-run-schemas";
import { formatRunCodeFallbackOutput } from "./agent-run-utils";

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];

interface RunCodeFallbackOptions {
  append: (chunk: UIMessageChunk) => Promise<void>;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  sandbox: ProjectSandboxStub;
  setRunStage: (stage: string) => void;
}

export async function runRunCodeFallback({
  append,
  input,
  logger,
  sandbox,
  setRunStage,
}: RunCodeFallbackOptions): Promise<void> {
  logger.warn("mastra_first_chunk_timeout_fallback", { timeoutMs: 45_000 });
  setRunStage("Running Python in the sandbox after model timeout.");
  const result = await executeRunCodeTool(createSandboxReadinessRunCodeInput(input.messageText), {
    sandbox,
    workspaceDir: `/workspace/${input.workspaceSlug}`,
  });
  await append({
    type: "text-delta",
    id: "answer",
    delta: formatRunCodeFallbackOutput(result),
  });
}
