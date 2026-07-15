import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOption, readRequiredOptionValue } from "./cli-options";
import { type ConfigRecord, isRecord, parseJsoncObject } from "./jsonc";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/i;

const WORKER_CONFIG_PATHS = [
  "apps/gateway-worker/wrangler.jsonc",
  "apps/agent-worker/wrangler.jsonc",
  "apps/webhooks-worker/wrangler.jsonc",
] as const;

interface Options {
  apply: boolean;
  id: string;
}

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function usage(): string {
  return [
    "Usage: pnpm prod:set-hyperdrive -- --id <hyperdrive-config-id> [--apply]",
    "",
    "Updates every production Worker wrangler.jsonc HYPERDRIVE binding.",
    "Dry-run is the default. Pass --apply to write files.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  let apply = false;
  let id: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const option = readOption(argv, index);
    switch (option.name) {
      case "--":
        break;
      case "--apply":
        apply = true;
        break;
      case "--help":
      case "-h":
        writeLine(usage());
        return process.exit(0);
      case "--id": {
        const parsed = readRequiredOptionValue(argv, index, option, "a Hyperdrive config id.");
        id = parsed.value;
        index = parsed.nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${option.name}`);
    }
  }

  if (!id) {
    throw new Error("--id is required.");
  }
  if ((!UUID_PATTERN.test(id) && !CLOUDFLARE_ID_PATTERN.test(id)) || id === ZERO_UUID) {
    throw new Error("--id must be a non-placeholder Hyperdrive config id.");
  }
  return { apply, id };
}

function readConfig(configPath: string): ConfigRecord {
  const absolutePath = join(ROOT, configPath);
  return parseJsoncObject(readFileSync(absolutePath, "utf8"), configPath);
}

function updateHyperdriveId(configPath: string, id: string, apply: boolean): boolean {
  const config = readConfig(configPath);
  const bindings = config["hyperdrive"];
  if (!Array.isArray(bindings)) {
    throw new Error(`${configPath} is missing a hyperdrive array.`);
  }

  let changed = false;
  let matchCount = 0;
  for (const binding of bindings) {
    if (!isRecord(binding) || binding["binding"] !== "HYPERDRIVE") {
      continue;
    }
    matchCount += 1;
    changed ||= binding["id"] !== id;
    binding["id"] = id;
  }

  if (matchCount !== 1) {
    throw new Error(`${configPath} must contain exactly one HYPERDRIVE binding.`);
  }

  if (!changed) {
    return false;
  }
  if (apply) {
    writeFileSync(join(ROOT, configPath), `${JSON.stringify(config, null, 2)}\n`);
  }
  return true;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  writeLine(
    options.apply ? "Updating production Hyperdrive IDs." : "Hyperdrive ID update dry-run.",
  );

  for (const configPath of WORKER_CONFIG_PATHS) {
    const relativePath = relative(ROOT, join(ROOT, configPath));
    const changed = updateHyperdriveId(configPath, options.id, options.apply);
    const state = changed ? (options.apply ? "updated" : "would update") : "already set";
    writeLine(`- ${relativePath}: ${state}`);
  }

  if (!options.apply) {
    writeLine("");
    writeLine("Pass --apply to update the Worker configs.");
  }
}

main();
