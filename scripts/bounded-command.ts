import { type ChildProcess, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const FORCE_KILL_GRACE_MS = 10_000;

interface BoundedCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface CapturedCommandOptions extends BoundedCommandOptions {
  env?: NodeJS.ProcessEnv;
  maxOutputBytes: number;
}

export interface CapturedCommandResult {
  code: number;
  output: string;
  stderr: string;
  stdout: string;
}

function terminateChild(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch {
    child.kill(signal);
  }
}

function spawnCapturedChild(
  command: string,
  args: readonly string[],
  options: CapturedCommandOptions,
): ChildProcess {
  return spawn(command, args, {
    cwd: options.cwd,
    detached: process.platform !== "win32",
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Runs a bounded process group while retaining only size-limited UTF-8 output. */
export function runCapturedBoundedCommand(
  command: string,
  args: readonly string[],
  options: CapturedCommandOptions,
): Promise<CapturedCommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCapturedChild(command, args, options);
    const stderrDecoder = new StringDecoder("utf8");
    const stdoutDecoder = new StringDecoder("utf8");
    let failure: string | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let isSettled = false;
    let outputBytes = 0;
    let stderr = "";
    let stdout = "";
    const terminate = (message: string): void => {
      if (failure) return;
      failure = message;
      terminateChild(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminateChild(child, "SIGKILL"), FORCE_KILL_GRACE_MS);
    };
    const append = (stream: "stderr" | "stdout", decoder: StringDecoder, chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        terminate(`${command} exceeded its ${options.maxOutputBytes}-byte output limit.`);
        return;
      }
      if (stream === "stderr") stderr += decoder.write(chunk);
      else stdout += decoder.write(chunk);
    };
    child.stdout?.on("data", (chunk: Buffer) => append("stdout", stdoutDecoder, chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", stderrDecoder, chunk));
    const timeout = setTimeout(
      () => terminate(`${command} exceeded its ${options.timeoutMs}ms deadline.`),
      options.timeoutMs,
    );
    const settle = (callback: () => void): void => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      callback();
    };
    child.once("error", (error) => settle(() => reject(error)));
    child.once("close", (code) => {
      terminateChild(child, "SIGKILL");
      stderr += stderrDecoder.end();
      stdout += stdoutDecoder.end();
      if (failure) {
        settle(() => reject(new Error(failure)));
        return;
      }
      settle(() =>
        resolvePromise({ code: code ?? 1, output: `${stderr}\n${stdout}`, stderr, stdout }),
      );
    });
  });
}
