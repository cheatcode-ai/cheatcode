import { localProjectProcessCommand } from "./project-sandbox-local-source";
import {
  EXPO_RUNTIME_BIN,
  EXPO_RUNTIME_DIR,
  NEXT_RUNTIME_BIN,
  NEXT_RUNTIME_DIR,
  resolveProjectLocalRuntime,
} from "./project-sandbox-package-runtime";

interface LocalPreviewCommandInput {
  port: number;
  sourceDir: string;
  workspaceSlug: string;
}

/** Runs Next from native sandbox disk while `/workspace` remains the durable project source. */
export function localNextPreviewCommand(input: LocalPreviewCommandInput): string[] {
  const runtime = requireLocalPreviewRuntime(input);
  const nextCommand = [
    NEXT_RUNTIME_BIN,
    "dev",
    "--webpack",
    "--hostname",
    "0.0.0.0",
    "--port",
    String(input.port),
  ];
  return localProjectProcessCommand(runtime, nextCommand, NEXT_RUNTIME_DIR);
}

/** Runs Expo/Metro from native sandbox disk while `/workspace` remains durable source. */
export function localExpoPreviewCommand(input: LocalPreviewCommandInput): string[] {
  const runtime = requireLocalPreviewRuntime(input);
  const expoCommand = [
    EXPO_RUNTIME_BIN,
    "start",
    "-c",
    "--web",
    "--host",
    "lan",
    "--port",
    String(input.port),
  ];
  return localProjectProcessCommand(runtime, expoCommand, EXPO_RUNTIME_DIR);
}

function requireLocalPreviewRuntime(input: LocalPreviewCommandInput) {
  const runtime = resolveProjectLocalRuntime(input.sourceDir);
  if (!runtime || runtime.workspaceSlug !== input.workspaceSlug) {
    throw new TypeError("Preview source does not match its workspace slug.");
  }
  return runtime;
}
