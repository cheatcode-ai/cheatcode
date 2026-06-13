import { spawnSync } from "node:child_process";

const SANDBOX_NAME_FILTER = "cheatcode-sandbox";

interface CleanOptions {
  dryRun: boolean;
  quiet: boolean;
}

function writeLine(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function writeError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function parseArgs(argv: string[]): CleanOptions {
  const options: CleanOptions = { dryRun: false, quiet: false };
  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      writeLine("Usage: pnpm docker:clean [--dry-run] [--quiet]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function docker(args: string[]): string {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || "docker command failed";
    throw new Error(message);
  }
  return result.stdout.trim();
}

function listSandboxContainers(): string[] {
  const output = docker(["ps", "-aq", "--filter", `name=${SANDBOX_NAME_FILTER}`]);
  return output.split("\n").filter((line) => line.length > 0);
}

function clean(options: CleanOptions): void {
  const ids = listSandboxContainers();
  if (ids.length === 0) {
    if (!options.quiet) {
      writeLine("No local Cheatcode sandbox containers to remove.");
    }
    return;
  }

  if (options.dryRun) {
    writeLine(`Would remove ${ids.length} local Cheatcode sandbox container(s):`);
    writeLine(ids.join("\n"));
    return;
  }

  docker(["rm", "-f", ...ids]);
  if (!options.quiet) {
    writeLine(`Removed ${ids.length} local Cheatcode sandbox container(s).`);
  }
}

try {
  clean(parseArgs(process.argv.slice(2)));
} catch (error) {
  writeError(error instanceof Error ? error.message : "Unknown Docker cleanup failure.");
  process.exitCode = 1;
}
