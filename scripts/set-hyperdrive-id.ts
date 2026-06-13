import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOption, readRequiredOptionValue } from "./cli-options";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/i;

const WORKER_CONFIG_PATHS = [
  "apps/gateway-worker/wrangler.jsonc",
  "apps/agent-worker/wrangler.jsonc",
  "apps/webhooks-worker/wrangler.jsonc",
] as const;

interface ConfigRecord {
  [key: string]: unknown;
}

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

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConfig(configPath: string): ConfigRecord {
  const absolutePath = join(ROOT, configPath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${configPath} must parse to a JSON object.`);
  }
  return parsed;
}

function updateHyperdriveId(configPath: string, id: string): boolean {
  const config = readConfig(configPath);
  const bindings = config["hyperdrive"];
  if (!Array.isArray(bindings)) {
    throw new Error(`${configPath} is missing a hyperdrive array.`);
  }

  let changed = false;
  for (const binding of bindings) {
    if (!isRecord(binding) || binding["binding"] !== "HYPERDRIVE") {
      continue;
    }
    changed = binding["id"] !== id;
    binding["id"] = id;
  }

  if (!changed) {
    return false;
  }

  writeFileSync(join(ROOT, configPath), `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  writeLine(
    options.apply ? "Updating production Hyperdrive IDs." : "Hyperdrive ID update dry-run.",
  );

  for (const configPath of WORKER_CONFIG_PATHS) {
    const relativePath = relative(ROOT, join(ROOT, configPath));
    if (options.apply) {
      const changed = updateHyperdriveId(configPath, options.id);
      writeLine(`- ${relativePath}: ${changed ? "updated" : "already set"}`);
    } else {
      writeLine(`- ${relativePath}: would set HYPERDRIVE id`);
    }
  }

  if (!options.apply) {
    writeLine("");
    writeLine("Pass --apply to update the Worker configs.");
  }
}

main();
