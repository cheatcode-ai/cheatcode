import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOption, readRequiredOptionValue } from "./cli-options";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_ENV_FILES = [
  ".env.local",
  ".env.development",
  "docker.dev",
  "apps/agent-worker/.dev.vars",
  "apps/gateway-worker/.dev.vars",
  "apps/webhooks-worker/.dev.vars",
] as const;

const WORKER_SECRETS = [
  {
    envKey: "BL_API_KEY",
    workerDir: "apps/agent-worker",
    workerName: "cheatcode-agent",
  },
  {
    envKey: "BL_WORKSPACE",
    workerDir: "apps/agent-worker",
    workerName: "cheatcode-agent",
  },
  {
    envKey: "BL_REGION",
    workerDir: "apps/agent-worker",
    workerName: "cheatcode-agent",
  },
  {
    envKey: "OUTPUT_DOWNLOAD_SIGNING_SECRET",
    workerDir: "apps/agent-worker",
    workerName: "cheatcode-agent",
  },
] as const;

export const REQUIRED_WORKER_SECRET_KEYS = WORKER_SECRETS.map((secret) => secret.envKey);

export interface EnvValue {
  sourcePath: string;
  value: string;
}

interface MatchedSecret {
  envKey: string;
  sourcePath: string;
  value: string;
  workerDir: string;
  workerName: string;
}

interface Options {
  allowPartial: boolean;
  apply: boolean;
  envFiles: string[];
}

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function usage(): string {
  return [
    "Usage: pnpm sync:worker-secrets -- [--env-file <path> ...] [--allow-partial] [--apply]",
    "",
    "Syncs standard Worker secrets required by SDKs that cannot read Secrets Store bindings.",
    "Currently syncs Blaxel and output-download signing secrets to cheatcode-agent.",
    "Dry-run is the default. Values are never printed. Missing required secrets fail unless --allow-partial is set.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  const envFiles: string[] = [];
  let allowPartial = false;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const option = readOption(argv, index);
    switch (option.name) {
      case "--":
        break;
      case "--allow-partial":
        allowPartial = true;
        break;
      case "--apply":
        apply = true;
        break;
      case "--help":
      case "-h":
        writeLine(usage());
        return process.exit(0);
      case "--env-file": {
        const parsed = readRequiredOptionValue(argv, index, option, "a path.");
        envFiles.push(parsed.value);
        index = parsed.nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${option.name}`);
    }
  }

  return {
    allowPartial,
    apply,
    envFiles: envFiles.length > 0 ? envFiles : [...DEFAULT_ENV_FILES],
  };
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

export function parseEnvFile(filePath: string): Map<string, string> {
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
    if (/^[A-Z0-9_]+$/.test(key)) {
      values.set(key, unquote(normalized.slice(delimiterIndex + 1)));
    }
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
  return WORKER_SECRETS.flatMap((secret) => {
    const envValue = envValues.get(secret.envKey);
    return envValue
      ? [
          {
            envKey: secret.envKey,
            sourcePath: envValue.sourcePath,
            value: envValue.value,
            workerDir: secret.workerDir,
            workerName: secret.workerName,
          },
        ]
      : [];
  });
}

export function missingSecretKeys(envValues: Map<string, EnvValue>): string[] {
  return WORKER_SECRETS.flatMap((secret) => (envValues.has(secret.envKey) ? [] : [secret.envKey]));
}

export function wranglerVersionsSecretPutArgs(secretKey: string): string[] {
  return [
    "exec",
    "wrangler",
    "versions",
    "secret",
    "put",
    secretKey,
    "--message",
    `Sync ${secretKey} via sync-worker-secrets`,
  ];
}

function runWranglerSecretPut(secret: MatchedSecret): Promise<void> {
  writeLine(`Putting ${secret.envKey} on ${secret.workerName} with Workers Versions.`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", wranglerVersionsSecretPutArgs(secret.envKey), {
      cwd: resolve(ROOT, secret.workerDir),
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
  const missingKeys = missingSecretKeys(envValues);

  if (matchedSecrets.length === 0) {
    writeError("No supported Worker secret keys were found in the selected env files.");
    process.exitCode = 1;
    return;
  }

  if (missingKeys.length > 0 && !options.allowPartial) {
    writeError("Missing required Worker secret keys in the selected env files:");
    for (const key of missingKeys) {
      writeError(`- ${key}`);
    }
    writeError("");
    writeError(
      "Use the default env-file search path or pass --allow-partial for targeted debugging.",
    );
    process.exitCode = 1;
    return;
  }

  writeLine(options.apply ? "Applying Worker secret sync." : "Worker secret sync dry-run.");
  for (const secret of matchedSecrets) {
    writeLine(`- ${secret.envKey} -> ${secret.workerName} (${relative(ROOT, secret.sourcePath)})`);
  }

  if (!options.apply) {
    writeLine("");
    writeLine("Pass --apply after the Worker exists to put the listed secrets.");
    return;
  }

  for (const secret of matchedSecrets) {
    await runWranglerSecretPut(secret);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    writeError(error instanceof Error ? error.message : "Unknown sync-worker-secrets failure.");
    process.exitCode = 1;
  });
}
