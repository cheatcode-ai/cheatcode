import { executeRunCodeTool } from "@cheatcode/agent-core";
import type { createLogger } from "@cheatcode/observability";
import type { ArtifactRuntime, CodeRuntimeContext } from "@cheatcode/tools-code";
import type { UIMessageChunk } from "ai";
import { formatRunCodeFallbackOutput } from "./agent-run-utils";

export type DirectRunCodeInput = { code: string; language: "javascript" | "python" };

type ProjectSandboxStub = CodeRuntimeContext["sandbox"];

export interface DirectRunCodeDeps {
  append: (chunk: UIMessageChunk) => Promise<void>;
  artifacts: ArtifactRuntime;
  logger: ReturnType<typeof createLogger>;
  sandbox: ProjectSandboxStub;
  setRunStage: (stage: string) => void;
  // The run's project folder (/workspace/<slug>); passed to the code runtime for parity with the
  // main path, though inline runCode itself has no cwd. Omitted (slug-less) leaves the default.
  workspaceDir?: string;
}

/** Executes a compiled direct-runCode snippet in the sandbox (run-control §5.3). */
export async function runDirectRunCode(
  deps: DirectRunCodeDeps,
  runCodeInput: DirectRunCodeInput,
): Promise<void> {
  deps.logger.info("direct_run_code_started", { language: runCodeInput.language });
  deps.setRunStage("Running requested code in the sandbox.");
  await deps.append({ data: { status: "starting", v: 1 }, type: "data-sandbox-status" });
  const result = await executeRunCodeTool(runCodeInput, {
    artifacts: deps.artifacts,
    sandbox: deps.sandbox,
    ...(deps.workspaceDir ? { workspaceDir: deps.workspaceDir } : {}),
  });
  deps.logger.info("direct_run_code_completed", {
    exitCode: result.exitCode,
    language: runCodeInput.language,
    stderrBytes: result.stderr.length,
    stdoutBytes: result.stdout.length,
    success: result.success,
  });
  await deps.append({ data: { status: "ready", v: 1 }, type: "data-sandbox-status" });
  await deps.append({
    delta: formatRunCodeFallbackOutput(result),
    id: "answer",
    type: "text-delta",
  });
}

/**
 * Detects a narrow "run/execute and print <arithmetic>" prompt and compiles it
 * into a safe direct runCode snippet. Returns null for anything outside that
 * deterministic shape so the normal agent loop handles it. Extracted from
 * `agent-run.ts` to keep that file under the line cap (run-control §5.3).
 */
export function directRunCodeInputFromPrompt(messageText: string): DirectRunCodeInput | null {
  const normalized = messageText.toLowerCase();
  if (!normalized.includes("run") && !normalized.includes("execute")) {
    return null;
  }
  const arithmeticPrint = messageText.match(/\bprint\s+([0-9][0-9\s+\-*/().]*)/i);
  if (!arithmeticPrint?.[1]) {
    return null;
  }
  const expression = arithmeticPrint[1].trim();
  if (!isSafeArithmeticExpression(expression)) {
    return null;
  }
  const language =
    normalized.includes("javascript") || normalized.includes("node") ? "javascript" : "python";
  const literal = exactPrintLiteral(messageText);
  return {
    code: directRunCode({ expression, language, literal }),
    language,
  };
}

function isSafeArithmeticExpression(expression: string): boolean {
  return /^[0-9\s+\-*/().]+$/.test(expression) && /[0-9]/.test(expression);
}

function exactPrintLiteral(messageText: string): string | null {
  const quoted = messageText.match(/\bprint\s+exactly\s+["'`]([^"'`\r\n]{1,120})["'`]/i)?.[1];
  if (quoted && isSafePrintLiteral(quoted)) {
    return quoted.trim();
  }
  const token = messageText.match(
    /\bprint\s+exactly\s+([A-Za-z0-9][A-Za-z0-9_.:-]{0,120})\b/i,
  )?.[1];
  return token && isSafePrintLiteral(token) ? token : null;
}

function isSafePrintLiteral(value: string): boolean {
  return /^[\w .:-]{1,120}$/.test(value.trim());
}

function directRunCode(input: {
  expression: string;
  language: "javascript" | "python";
  literal: string | null;
}): string {
  const literalLine = input.literal ? `${printStatement(input.language, input.literal)}\n` : "";
  return `${literalLine}${printStatement(input.language, input.expression)}`;
}

function printStatement(language: "javascript" | "python", value: string): string {
  if (isSafeArithmeticExpression(value)) {
    return language === "javascript" ? `console.log(${value});` : `print(${value})`;
  }
  const quoted = JSON.stringify(value) ?? '""';
  return language === "javascript" ? `console.log(${quoted});` : `print(${quoted})`;
}
