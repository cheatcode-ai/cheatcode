import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOption, readRequiredOptionValue } from "./cli-options";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface SecretSpec {
  envKey: string;
  secretName: string;
}

interface EnvValue {
  source: string;
  value: string;
}

interface MatchedSecret extends SecretSpec, EnvValue {}

interface SyncOptions {
  apply: boolean;
  envFiles: string[];
  keys: string[];
  storeId?: string;
}

interface SyncArgState {
  apply: boolean;
  envFiles: string[];
  keys: string[];
  storeId?: string;
}

const DEFAULT_ENV_FILES = [
  ".env.local",
  ".env.development",
  "docker.dev",
  "apps/web/.env.local",
  "apps/agent-worker/.dev.vars",
  "apps/gateway-worker/.dev.vars",
  "apps/webhooks-worker/.dev.vars",
] as const;

export const SECRET_SPECS: readonly SecretSpec[] = [
  { envKey: "DAYTONA_API_KEY", secretName: "daytona-api-key" },
  { envKey: "DAYTONA_WEBHOOK_SIGNING_SECRET", secretName: "daytona-webhook-signing-secret" },
  { envKey: "PREVIEW_TOKEN_SECRET", secretName: "preview-token-secret" },
  { envKey: "OUTPUT_DOWNLOAD_SIGNING_SECRET", secretName: "output-download-signing-secret" },
  { envKey: "CLERK_SECRET_KEY", secretName: "clerk-secret-key" },
  { envKey: "CLERK_JWT_KEY", secretName: "clerk-jwt-key" },
  { envKey: "CLERK_WEBHOOK_SIGNING_SECRET", secretName: "clerk-webhook-signing-secret" },
  { envKey: "POLAR_ACCESS_TOKEN", secretName: "polar-access-token" },
  { envKey: "POLAR_WEBHOOK_SECRET", secretName: "polar-webhook-secret" },
  { envKey: "COMPOSIO_API_KEY", secretName: "composio-api-key" },
  { envKey: "DEEPSEEK_PLATFORM_API_KEY", secretName: "deepseek-platform-api-key" },
  { envKey: "COMPOSIO_AUTH_CONFIGS", secretName: "composio-auth-configs" },
  { envKey: "COMPOSIO_WEBHOOK_SECRET", secretName: "composio-webhook-secret" },
  {
    envKey: "CLOUDFLARE_ANALYTICS_API_TOKEN",
    secretName: "cloudflare-analytics-api-token",
  },
  { envKey: "INTERNAL_ALERT_WEBHOOK_SECRET", secretName: "internal-alert-webhook-secret" },
  { envKey: "INTERNAL_MAINTENANCE_SECRET", secretName: "internal-maintenance-secret" },
];

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function usage(): string {
  return [
    "Usage: pnpm sync:secrets -- [--env-file <path> ...] [--key <ENV_KEY> ...] [--store-id <id>] [--apply]",
    "",
    "Creates missing Cloudflare Secrets Store entries and rotates existing entries by name.",
    "Dry-run is the default. Values are sent only in authenticated request bodies and never printed.",
  ].join("\n");
}

function parseArgs(argv: string[]): SyncOptions {
  const state: SyncArgState = { apply: false, envFiles: [], keys: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const option = readOption(argv, index);
    index = applyOption(argv, index, option, state);
  }
  return {
    apply: state.apply,
    envFiles: state.envFiles.length > 0 ? state.envFiles : [...DEFAULT_ENV_FILES],
    keys: state.keys,
    ...(state.storeId ? { storeId: state.storeId } : {}),
  };
}

function applyOption(
  argv: string[],
  index: number,
  option: ReturnType<typeof readOption>,
  state: SyncArgState,
): number {
  switch (option.name) {
    case "--":
      return index;
    case "--apply":
      state.apply = true;
      return index;
    case "--help":
    case "-h":
      writeLine(usage());
      return process.exit(0);
    case "--env-file": {
      const parsed = readRequiredOptionValue(argv, index, option, "a path.");
      state.envFiles.push(parsed.value);
      return parsed.nextIndex;
    }
    case "--key": {
      const parsed = readRequiredOptionValue(argv, index, option, "a supported env key.");
      state.keys.push(parsed.value);
      return parsed.nextIndex;
    }
    case "--store-id": {
      const parsed = readRequiredOptionValue(argv, index, option, "a Secrets Store ID.");
      state.storeId = parsed.value;
      return parsed.nextIndex;
    }
    default:
      throw new Error(`Unknown argument: ${option.name}`);
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (trimmed.length < 2 || !quote || quote !== trimmed.at(-1)) {
    return trimmed;
  }
  if (quote === "'" || quote === "`") {
    return trimmed.slice(1, -1);
  }
  if (quote !== '"') {
    return trimmed;
  }
  return trimmed
    .slice(1, -1)
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t")
    .replaceAll('\\"', '"')
    .replaceAll("\\\\", "\\");
}

function parseEnvFile(filePath: string): Map<string, string> {
  const values = new Map<string, string>();
  const content = readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const delimiterIndex = normalized.indexOf("=");
    const key = normalized.slice(0, delimiterIndex).trim();
    if (delimiterIndex > 0 && /^[A-Z0-9_]+$/u.test(key)) {
      values.set(key, unquote(normalized.slice(delimiterIndex + 1)));
    }
  }
  return values;
}

function loadEnvFiles(envFiles: string[]): Map<string, EnvValue> {
  const values = new Map<string, EnvValue>();
  for (const envFile of envFiles) {
    const sourcePath = resolve(ROOT, envFile);
    if (!existsSync(sourcePath)) continue;
    for (const [key, value] of parseEnvFile(sourcePath)) {
      if (value) values.set(key, { source: relative(ROOT, sourcePath), value });
    }
  }
  for (const spec of SECRET_SPECS) {
    const value = process.env[spec.envKey]?.trim();
    if (value) values.set(spec.envKey, { source: "process environment", value });
  }
  return values;
}

function matchSecrets(envValues: Map<string, EnvValue>, keys: string[]): MatchedSecret[] {
  const selected = new Set(keys);
  const unknownKeys = keys.filter((key) => !SECRET_SPECS.some((spec) => spec.envKey === key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unsupported secret keys: ${unknownKeys.join(", ")}.`);
  }
  return SECRET_SPECS.flatMap((spec) => {
    if (selected.size > 0 && !selected.has(spec.envKey)) return [];
    const value = envValues.get(spec.envKey);
    return value ? [{ ...spec, ...value }] : [];
  });
}

function wranglerArgs(args: string[]): string[] {
  return ["--dir", "apps/gateway-worker", "exec", "wrangler", ...args];
}

function runWranglerCapture(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", wranglerArgs(args), {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolvePromise(stdout);
      reject(new Error(stderr.trim() || `wrangler exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function listSecretIds(storeId: string): Promise<Map<string, string>> {
  const output = await runWranglerCapture([
    "secrets-store",
    "secret",
    "list",
    storeId,
    "--remote",
    "--per-page",
    "100",
  ]);
  const ids = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const cells = line.split("│").map((cell) => cell.trim());
    const name = cells[1];
    const id = cells[2];
    if (name && id && /^[a-z0-9-]+$/u.test(name) && /^[0-9a-f]{32}$/u.test(id)) {
      ids.set(name, id);
    }
  }
  return ids;
}

function runSecretCommand(args: string[], value: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", wranglerArgs(args), {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.end(`${value}\n`);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolvePromise();
      reject(new Error(`wrangler exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function upsertSecret(
  storeId: string,
  existingIds: ReadonlyMap<string, string>,
  secret: MatchedSecret,
): Promise<"created" | "updated"> {
  const secretId = existingIds.get(secret.secretName);
  const command = secretId
    ? [
        "secrets-store",
        "secret",
        "update",
        storeId,
        "--secret-id",
        secretId,
        "--scopes",
        "workers",
        "--remote",
      ]
    : [
        "secrets-store",
        "secret",
        "create",
        storeId,
        "--name",
        secret.secretName,
        "--scopes",
        "workers",
        "--remote",
      ];
  await runSecretCommand(command, secret.value);
  return secretId ? "updated" : "created";
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const envValues = loadEnvFiles(options.envFiles);
  const matchedSecrets = matchSecrets(envValues, options.keys);
  if (matchedSecrets.length === 0) {
    throw new Error("No supported secret keys were found in the selected env files.");
  }
  writeLine(options.apply ? "Applying Secrets Store sync." : "Secrets Store sync dry-run.");
  for (const secret of matchedSecrets) {
    writeLine(`- ${secret.envKey} -> ${secret.secretName} (${secret.source})`);
  }
  if (!options.apply) {
    writeLine("\nPass --apply --store-id <STORE_ID> to create or rotate the listed secrets.");
    return;
  }
  if (!options.storeId) throw new Error("--store-id is required when --apply is set.");
  const existingIds = await listSecretIds(options.storeId);
  for (const secret of matchedSecrets) {
    writeLine(`${await upsertSecret(options.storeId, existingIds, secret)} ${secret.secretName}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    writeError(error instanceof Error ? error.message : "Unknown sync-secrets failure.");
    process.exitCode = 1;
  });
}
