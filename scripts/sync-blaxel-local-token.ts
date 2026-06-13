import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DEV_VARS_PATH = join(ROOT, "apps/agent-worker/.dev.vars");
const EXPIRY_LEEWAY_MS = 60_000;

interface BlaxelSyncResult {
  changed: boolean;
  message: string;
}

type ConfigRecord = Record<string, unknown>;

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function usage(): string {
  return [
    "Usage: pnpm sync:blaxel-local-token [--no-refresh]",
    "",
    "Refreshes Blaxel CLI auth, then syncs the CLI access token into",
    "apps/agent-worker/.dev.vars when the existing BL_API_KEY is a CLI JWT.",
    "Long-lived non-JWT API keys are left unchanged.",
  ].join("\n");
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const quote = trimmed[0];
  const last = trimmed.at(-1);
  if ((quote !== '"' && quote !== "'") || quote !== last) {
    return trimmed;
  }

  return trimmed.slice(1, -1);
}

function blaxelConfigPath(): string {
  const home = process.env["HOME"];
  if (!home) {
    throw new Error("HOME is not set; cannot locate ~/.blaxel/config.yaml.");
  }
  return join(home, ".blaxel/config.yaml");
}

function extractYamlScalar(content: string, key: string): string | undefined {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m");
  const value = content.match(pattern)?.[1];
  return value ? unquote(value) : undefined;
}

function readCliAccessToken(configPath = blaxelConfigPath()): string {
  if (!existsSync(configPath)) {
    throw new Error("Blaxel CLI config is missing. Run `bl login` first.");
  }

  const token = extractYamlScalar(readFileSync(configPath, "utf8"), "access_token");
  if (!token) {
    throw new Error("Blaxel CLI config does not contain an access token. Run `bl login` first.");
  }
  return token;
}

function decodeJwtExpirationMs(token: string): number | undefined {
  const [, payload] = token.split(".");
  if (!payload) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!isRecord(decoded) || typeof decoded["exp"] !== "number") {
      return undefined;
    }
    return decoded["exp"] * 1000;
  } catch {
    return undefined;
  }
}

function isExpired(expirationMs: number | undefined, nowMs: number): boolean {
  return expirationMs === undefined || expirationMs <= nowMs + EXPIRY_LEEWAY_MS;
}

function validCliExpirationMs(cliToken: string, nowMs: number): number {
  const expirationMs = decodeJwtExpirationMs(cliToken);
  if (expirationMs === undefined || isExpired(expirationMs, nowMs)) {
    throw new Error("Blaxel CLI access token is expired. Run `bl login` and try again.");
  }
  return expirationMs;
}

function readEnvValue(content: string, key: string): string | undefined {
  const pattern = new RegExp(`^${key}=(.*)$`, "m");
  const value = content.match(pattern)?.[1];
  return value === undefined ? undefined : unquote(value);
}

function writeEnvValue(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  const separator = content.endsWith("\n") || content.length === 0 ? "" : "\n";
  return `${content}${separator}${line}\n`;
}

export function shouldReplaceWorkerToken(
  workerToken: string | undefined,
  cliToken: string,
  nowMs: number,
): boolean {
  if (!workerToken) {
    validCliExpirationMs(cliToken, nowMs);
    return true;
  }

  const workerExpirationMs = decodeJwtExpirationMs(workerToken);
  if (workerExpirationMs === undefined) {
    return false;
  }

  const cliExpirationMs = validCliExpirationMs(cliToken, nowMs);
  if (workerToken === cliToken) {
    return false;
  }

  return isExpired(workerExpirationMs, nowMs) || cliExpirationMs > workerExpirationMs;
}

export async function refreshBlaxelCliAuth(): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("bl", ["get", "sandboxes"], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const details = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(details || `bl get sandboxes exited with code ${code ?? "unknown"}.`));
    });
  });
}

export function syncBlaxelLocalToken(nowMs = Date.now()): BlaxelSyncResult {
  const cliToken = readCliAccessToken();
  const content = existsSync(DEFAULT_DEV_VARS_PATH)
    ? readFileSync(DEFAULT_DEV_VARS_PATH, "utf8")
    : "";
  const workerToken = readEnvValue(content, "BL_API_KEY");

  if (!shouldReplaceWorkerToken(workerToken, cliToken, nowMs)) {
    return {
      changed: false,
      message:
        workerToken && decodeJwtExpirationMs(workerToken) === undefined
          ? "Blaxel local token sync skipped; apps/agent-worker/.dev.vars uses a non-JWT API key."
          : "Blaxel local token is already current.",
    };
  }

  writeFileSync(DEFAULT_DEV_VARS_PATH, writeEnvValue(content, "BL_API_KEY", cliToken));
  return {
    changed: true,
    message: "Synced refreshed Blaxel CLI token into apps/agent-worker/.dev.vars.",
  };
}

function parseArgs(argv: string[]): { refresh: boolean } {
  let refresh = true;
  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--no-refresh") {
      refresh = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      writeLine(usage());
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { refresh };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.refresh) {
    await refreshBlaxelCliAuth();
  }
  writeLine(syncBlaxelLocalToken().message);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    writeError(error instanceof Error ? error.message : "Unknown Blaxel local token sync failure.");
    process.exitCode = 1;
  });
}
