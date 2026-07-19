import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ParsedOption, readOption, readRequiredOptionValue } from "./cli-options";
import { type ConfigRecord, isRecord, parseJsoncObject } from "./jsonc";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const ZERO_CLOUDFLARE_ID = "00000000000000000000000000000000";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/i;

const WORKER_CONFIGS = [
  {
    configPath: "apps/gateway-worker/wrangler.jsonc",
    name: "gateway",
    option: "--gateway-id",
  },
  {
    configPath: "apps/agent-worker/wrangler.jsonc",
    name: "agent",
    option: "--agent-id",
  },
  {
    configPath: "apps/webhooks-worker/wrangler.jsonc",
    name: "webhooks",
    option: "--webhooks-id",
  },
] as const;

type WorkerName = (typeof WORKER_CONFIGS)[number]["name"];

interface Options {
  apply: boolean;
  ids: Record<WorkerName, string>;
}

interface HyperdriveUpdate {
  changed: boolean;
  configPath: string;
  content: string;
}

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function usage(): string {
  return [
    "Usage: pnpm cloudflare:set-hyperdrive -- --gateway-id <id> --agent-id <id> --webhooks-id <id> [--apply]",
    "",
    "Updates each production Worker with its dedicated HYPERDRIVE config.",
    "Dry-run is the default. Pass --apply to write files.",
  ].join("\n");
}

function parseArgs(argv: string[]): Options {
  let apply = false;
  const ids: Partial<Record<WorkerName, string>> = {};

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
      case "--gateway-id":
      case "--agent-id":
      case "--webhooks-id": {
        index = assignHyperdriveId(ids, argv, index, option);
        break;
      }
      default:
        throw new Error(`Unknown argument: ${option.name}`);
    }
  }

  return { apply, ids: validatedHyperdriveIds(ids) };
}

function assignHyperdriveId(
  ids: Partial<Record<WorkerName, string>>,
  argv: string[],
  index: number,
  option: ParsedOption,
): number {
  const parsed = readRequiredOptionValue(argv, index, option, "a Hyperdrive config id.");
  const worker = WORKER_CONFIGS.find((config) => config.option === option.name);
  if (!worker) {
    throw new Error(`Unknown Hyperdrive option: ${option.name}`);
  }
  if (ids[worker.name]) {
    throw new Error(`${option.name} may be provided only once.`);
  }
  ids[worker.name] = parsed.value;
  return parsed.nextIndex;
}

function validatedHyperdriveIds(
  ids: Partial<Record<WorkerName, string>>,
): Record<WorkerName, string> {
  for (const worker of WORKER_CONFIGS) {
    const id = ids[worker.name];
    if (!id) {
      throw new Error(`${worker.option} is required.`);
    }
    if (
      (!UUID_PATTERN.test(id) && !CLOUDFLARE_ID_PATTERN.test(id)) ||
      id === ZERO_UUID ||
      id === ZERO_CLOUDFLARE_ID
    ) {
      throw new Error(`${worker.option} must be a non-placeholder Hyperdrive config id.`);
    }
  }
  const completeIds = ids as Record<WorkerName, string>;
  if (new Set(Object.values(completeIds)).size !== WORKER_CONFIGS.length) {
    throw new Error("Gateway, agent, and webhooks must use three distinct Hyperdrive configs.");
  }
  return completeIds;
}

function readConfig(configPath: string): ConfigRecord {
  const absolutePath = join(ROOT, configPath);
  return parseJsoncObject(readFileSync(absolutePath, "utf8"), configPath);
}

function prepareHyperdriveUpdate(configPath: string, id: string): HyperdriveUpdate {
  const config = readConfig(configPath);
  const bindings = config["hyperdrive"];
  if (!Array.isArray(bindings)) {
    throw new Error(`${configPath} is missing a hyperdrive array.`);
  }

  let changed = false;
  let matchCount = 0;
  for (const [index, binding] of bindings.entries()) {
    if (!isRecord(binding)) {
      throw new Error(`${configPath} has an invalid hyperdrive binding at index ${index}.`);
    }
    if (binding["binding"] !== "HYPERDRIVE") {
      continue;
    }
    matchCount += 1;
    changed ||= binding["id"] !== id;
    binding["id"] = id;
  }

  if (matchCount !== 1) {
    throw new Error(`${configPath} must contain exactly one HYPERDRIVE binding.`);
  }

  return {
    changed,
    configPath,
    content: `${JSON.stringify(config, null, 2)}\n`,
  };
}

function applyUpdates(updates: readonly HyperdriveUpdate[]): void {
  for (const update of updates) {
    if (update.changed) {
      writeFileSync(join(ROOT, update.configPath), update.content);
    }
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  writeLine(
    options.apply ? "Updating production Hyperdrive IDs." : "Hyperdrive ID update dry-run.",
  );

  // Validate every config before writing any of them so a malformed later
  // Worker cannot leave a partially updated production topology.
  const updates = WORKER_CONFIGS.map((worker) =>
    prepareHyperdriveUpdate(worker.configPath, options.ids[worker.name]),
  );
  if (options.apply) {
    applyUpdates(updates);
  }

  for (const update of updates) {
    const relativePath = relative(ROOT, join(ROOT, update.configPath));
    const state = update.changed ? (options.apply ? "updated" : "would update") : "already set";
    writeLine(`- ${relativePath}: ${state}`);
  }

  if (!options.apply) {
    writeLine("");
    writeLine("Pass --apply to update the Worker configs.");
  }
}

main();
