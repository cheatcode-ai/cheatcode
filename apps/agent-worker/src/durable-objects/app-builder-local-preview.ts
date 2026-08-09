import { shellQuote } from "../sandbox-support";
import { localProjectProcessCommand } from "./project-sandbox-local-source";
import { NEXT_RUNTIME_BIN, resolveProjectLocalRuntime } from "./project-sandbox-package-runtime";

interface LocalPreviewCommandInput {
  port: number;
  sourceDir: string;
  workspaceSlug: string;
}

/** Runs Next from native sandbox disk while `/workspace` remains the durable project source. */
export function localNextPreviewCommand(input: LocalPreviewCommandInput): string[] {
  const runtime = resolveProjectLocalRuntime(input.sourceDir);
  if (!runtime || runtime.workspaceSlug !== input.workspaceSlug) {
    throw new TypeError("Preview source does not match its workspace slug.");
  }
  const nextCommand = [
    NEXT_RUNTIME_BIN,
    "dev",
    "--webpack",
    "--hostname",
    "0.0.0.0",
    "--port",
    String(input.port),
  ]
    .map(shellQuote)
    .join(" ");
  return ["sh", "-lc", localProjectProcessCommand(runtime, nextCommand)];
}
