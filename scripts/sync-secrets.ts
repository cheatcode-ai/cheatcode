import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOption, readRequiredOptionValue } from "./cli-options";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface SecretSpec {
  envKeys: readonly [string, ...string[]];
  secretName: string;
}

interface EnvValue {
  sourcePath: string;
  value: string;
}

interface MatchedSecret {
  envKey: string;
  secretName: string;
  sourcePath: string;
  value: string;
}

interface SyncOptions {
  apply: boolean;
  envFiles: string[];
  local: boolean;
  persistTo?: string;
  storeId?: string;
}

interface SyncArgState {
  apply: boolean;
  envFiles: string[];
  local: boolean;
  persistTo?: string;
  storeId?: string;
}

const DEFAULT_ENV_FILES = [
  ".env.local",
  ".env.development",
  "docker.dev",
  "cheatcode/backend/.env",
  "cheatcode/frontend/.env",
  "apps/web/.env.local",
  "apps/gateway-worker/.dev.vars",
  "apps/webhooks-worker/.dev.vars",
] as const;

export const SECRET_SPECS: readonly SecretSpec[] = [
  { envKeys: ["DAYTONA_API_KEY"], secretName: "daytona-api-key" },
  { envKeys: ["PREVIEW_TOKEN_SECRET"], secretName: "preview-token-secret" },
  // Blaxel secrets retained for rollback until post-QA; no longer read by code.
  { envKeys: ["BL_API_KEY"], secretName: "blaxel-api-key" },
  { envKeys: ["BL_REGION"], secretName: "blaxel-region" },
  { envKeys: ["BL_WORKSPACE"], secretName: "blaxel-workspace" },
  { envKeys: ["CLERK_SECRET_KEY"], secretName: "clerk-secret-key" },
  { envKeys: ["CLERK_JWT_KEY"], secretName: "clerk-jwt-key" },
  {
    envKeys: ["CLERK_WEBHOOK_SIGNING_SECRET", "CLERK_WEBHOOK_SECRET"],
    secretName: "clerk-webhook-signing-secret",
  },
  { envKeys: ["POLAR_ACCESS_TOKEN"], secretName: "polar-access-token" },
  { envKeys: ["POLAR_WEBHOOK_SECRET"], secretName: "polar-webhook-secret" },
  { envKeys: ["COMPOSIO_API_KEY"], secretName: "composio-api-key" },
  { envKeys: ["DEEPSEEK_PLATFORM_API_KEY"], secretName: "deepseek-platform-api-key" },
  { envKeys: ["COMPOSIO_AUTH_CONFIGS"], secretName: "composio-auth-configs" },
  { envKeys: ["COMPOSIO_WEBHOOK_SECRET"], secretName: "composio-webhook-secret" },
  {
    envKeys: ["CLOUDFLARE_ANALYTICS_API_TOKEN", "CLOUDFLARE_API_TOKEN"],
    secretName: "cloudflare-analytics-api-token",
  },
  { envKeys: ["INTERNAL_ALERT_WEBHOOK_SECRET"], secretName: "internal-alert-webhook-secret" },
  {
    envKeys: ["INTERNAL_MAINTENANCE_SECRET"],
    secretName: "internal-maintenance-secret",
  },
];

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function usage(): string {
  return [
    "Usage: pnpm sync:secrets -- [--env-file <path> ...] [--store-id <id>] [--apply] [--local] [--persist-to <dir>]",
    "",
    "Creates Cloudflare Secrets Store entries for the app-level secrets in plan.md.",
    "Dry-run is the default. Values are never printed.",
  ].join("\n");
}

function parseArgs(argv: string[]): SyncOptions {
  const state: SyncArgState = {
    apply: false,
    envFiles: [],
    local: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = readOption(argv, index);
    index = applyOption(argv, index, option, state);
  }

  const options: SyncOptions = {
    apply: state.apply,
    envFiles: state.envFiles.length > 0 ? state.envFiles : [...DEFAULT_ENV_FILES],
    local: state.local,
  };
  if (state.persistTo) {
    options.persistTo = state.persistTo;
  }
  if (state.storeId) {
    options.storeId = state.storeId;
  }
  return options;
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
    case "--local":
      state.local = true;
      return index;
    case "--help":
    case "-h":
      writeLine(usage());
      return process.exit(0);
    case "--env-file":
      return applyValueOption(argv, index, option, "a path.", state.envFiles);
    case "--store-id":
      state.storeId = readRequiredOptionValue(
        argv,
        index,
        option,
        "a Cloudflare Secrets Store ID.",
      ).value;
      return option.value === undefined ? index + 1 : index;
    case "--persist-to":
      state.persistTo = readRequiredOptionValue(argv, index, option, "a directory.").value;
      return option.value === undefined ? index + 1 : index;
    default:
      throw new Error(`Unknown argument: ${option.name}`);
  }
}

function applyValueOption(
  argv: string[],
  index: number,
  option: ReturnType<typeof readOption>,
  description: string,
  target: string[],
): number {
  const parsed = readRequiredOptionValue(argv, index, option, description);
  target.push(parsed.value);
  return parsed.nextIndex;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const quote = trimmed[0];
  const last = trimmed.at(-1);
  if ((quote !== '"' && quote !== "'" && quote !== "`") || quote !== last) {
    return trimmed;
  }

  const inner = trimmed.slice(1, -1);
  if (quote !== '"') {
    return inner;
  }

  return inner
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t")
    .replaceAll('\\"', '"')
    .replaceAll("\\\\", "\\");
}

function parseEnvFile(filePath: string): Map<string, string> {
  const values = new Map<string, string>();
  const content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const delimiterIndex = normalized.indexOf("=");
    if (delimiterIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, delimiterIndex).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) {
      continue;
    }

    values.set(key, unquote(normalized.slice(delimiterIndex + 1)));
  }
  return values;
}

function loadEnvFiles(envFiles: string[]): Map<string, EnvValue> {
  const values = new Map<string, EnvValue>();
  for (const envFile of envFiles) {
    const absolutePath = resolve(ROOT, envFile);
    if (!existsSync(absolutePath)) {
      continue;
    }

    for (const [key, value] of parseEnvFile(absolutePath)) {
      if (value.length > 0) {
        values.set(key, { sourcePath: absolutePath, value });
      }
    }
  }
  return values;
}

function matchSecrets(envValues: Map<string, EnvValue>): MatchedSecret[] {
  return SECRET_SPECS.flatMap((spec) => {
    for (const envKey of spec.envKeys) {
      const envValue = envValues.get(envKey);
      if (envValue) {
        return [
          {
            envKey,
            secretName: spec.secretName,
            sourcePath: envValue.sourcePath,
            value: envValue.value,
          },
        ];
      }
    }
    return [];
  });
}

function runWranglerSecretCreate(secret: MatchedSecret, options: SyncOptions): Promise<void> {
  if (!options.storeId) {
    throw new Error("--store-id is required when --apply is set.");
  }

  const args = [
    "--dir",
    "apps/gateway-worker",
    "exec",
    "wrangler",
    "secrets-store",
    "secret",
    "create",
    options.storeId,
    "--name",
    secret.secretName,
    "--scopes",
    "workers",
  ];

  if (!options.local) {
    args.push("--remote");
  }
  if (options.persistTo) {
    args.push("--persist-to", options.persistTo);
  }

  writeLine(`Creating ${secret.secretName} from ${secret.envKey}.`);

  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", args, {
      cwd: ROOT,
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.end(`${secret.value}\n`);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`wrangler exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const envValues = loadEnvFiles(options.envFiles);
  const matchedSecrets = matchSecrets(envValues);

  if (matchedSecrets.length === 0) {
    writeError("No supported secret keys were found in the selected env files.");
    process.exitCode = 1;
    return;
  }

  writeLine(options.apply ? "Applying Cloudflare Secrets Store sync." : "Secrets sync dry-run.");
  for (const secret of matchedSecrets) {
    writeLine(`- ${secret.envKey} -> ${secret.secretName} (${relative(ROOT, secret.sourcePath)})`);
  }

  if (!options.apply) {
    writeLine("");
    writeLine("Pass --apply --store-id <STORE_ID> to create the listed secrets.");
    return;
  }

  for (const secret of matchedSecrets) {
    await runWranglerSecretCreate(secret, options);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    writeError(error instanceof Error ? error.message : "Unknown sync-secrets failure.");
    process.exitCode = 1;
  });
}
