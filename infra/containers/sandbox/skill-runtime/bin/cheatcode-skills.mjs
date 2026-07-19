#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const CLI_NAME = "cheatcode-skills";
const DEFAULT_SKILLS_HOME = "/home/node/.cheatcode";
const CUSTOM_SKILLS_ROOT = "/workspace/.cheatcode/skills";
const DEFAULT_SKILLS_DIRECTORY = "default-skills";
const DEFAULT_TSX_BINARY = "/opt/cheatcode-skill-runtime/node_modules/.bin/tsx";

function shellQuote(value) {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getSkillsHome() {
  const envValue = process.env.CHEATCODE_SKILLS_HOME?.trim();
  return envValue && envValue.length > 0 ? envValue : DEFAULT_SKILLS_HOME;
}

function normalizeToolPath(rawToolPath) {
  const trimmed = rawToolPath.trim().replace(/^\/+/, "").replace(/\.ts$/, "");

  if (!trimmed) {
    return null;
  }

  const normalized = path.posix.normalize(trimmed);

  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }

  return normalized;
}

function getRuntimePaths(toolPath) {
  const skillsHome = getSkillsHome();
  const tsconfigPath = path.posix.join(skillsHome, "tsconfig.json");
  const customToolFilePath = path.posix.join(CUSTOM_SKILLS_ROOT, `${toolPath}.ts`);
  const builtInToolFilePath = path.posix.join(
    skillsHome,
    DEFAULT_SKILLS_DIRECTORY,
    `${toolPath}.ts`,
  );
  const toolFilePath = existsSync(customToolFilePath)
    ? customToolFilePath
    : builtInToolFilePath;

  return {
    skillsHome,
    tsconfigPath,
    toolFilePath,
  };
}

function getDirectCommand(toolPath, forwardedArgs) {
  const runtimePaths = getRuntimePaths(toolPath);
  return {
    ...runtimePaths,
    command: process.env.CHEATCODE_TSX_BINARY?.trim() || DEFAULT_TSX_BINARY,
    args: [
      "--tsconfig",
      runtimePaths.tsconfigPath,
      runtimePaths.toolFilePath,
      ...forwardedArgs,
    ],
  };
}

function renderDirectCommand(directCommand) {
  return [directCommand.command, ...directCommand.args].map(shellQuote).join(" ");
}

function printUsage(exitCode) {
  const output = exitCode === 0 ? console.log : console.error;
  output(`Usage:
  ${CLI_NAME} <skill>/<tool> [tool args...]
  ${CLI_NAME} help <skill>/<tool>
  ${CLI_NAME} which <skill>/<tool>

Examples:
  ${CLI_NAME} gmail/messages/recent --count 5
  ${CLI_NAME} help googledocs/documents/update-markdown
  ${CLI_NAME} which notion/pages/get

This wrapper resolves custom tools under /workspace/.cheatcode/skills first,
then built-in tools under /home/node/.cheatcode/default-skills, and runs:
  /opt/cheatcode-skill-runtime/node_modules/.bin/tsx --tsconfig /home/node/.cheatcode/tsconfig.json <resolved-tool>.ts ...
`);
  process.exit(exitCode);
}

function fail(message, directCommand) {
  console.error(`[${CLI_NAME}] ${message}`);

  if (directCommand) {
    console.error(`[${CLI_NAME}] Direct fallback: ${renderDirectCommand(directCommand)}`);
    console.error(
      `[${CLI_NAME}] If the wrapper may be the issue, run the direct command above to rule out launcher problems.`,
    );
  }

  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const [firstArg, ...restArgs] = rawArgs;

if (!firstArg || firstArg === "--help" || firstArg === "-h") {
  printUsage(0);
}

if (firstArg === "which") {
  const toolPath = normalizeToolPath(restArgs[0] ?? "");
  if (!toolPath) {
    printUsage(1);
  }

  console.log(renderDirectCommand(getDirectCommand(toolPath, restArgs.slice(1))));
  process.exit(0);
}

if (firstArg === "help") {
  const toolPath = normalizeToolPath(restArgs[0] ?? "");
  if (!toolPath) {
    printUsage(1);
  }

  const directCommand = getDirectCommand(toolPath, ["--help", ...restArgs.slice(1)]);

  if (!existsSync(directCommand.tsconfigPath)) {
    fail(`Missing sandbox skills tsconfig at ${directCommand.tsconfigPath}.`, directCommand);
  }

  if (!existsSync(directCommand.toolFilePath)) {
    fail(
      `Skill tool "${toolPath}" was not found at ${directCommand.toolFilePath}.`,
      directCommand,
    );
  }

  const result = spawnSync(directCommand.command, directCommand.args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    fail(
      `Failed to start the underlying skill help command: ${result.error.message}`,
      directCommand,
    );
  }

  process.exit(result.status ?? 1);
}

const toolPath = normalizeToolPath(firstArg);
if (!toolPath) {
  printUsage(1);
}

const directCommand = getDirectCommand(toolPath, restArgs);

if (!existsSync(directCommand.tsconfigPath)) {
  fail(`Missing sandbox skills tsconfig at ${directCommand.tsconfigPath}.`, directCommand);
}

if (!existsSync(directCommand.toolFilePath)) {
  fail(
    `Skill tool "${toolPath}" was not found at ${directCommand.toolFilePath}.`,
    directCommand,
  );
}

const result = spawnSync(directCommand.command, directCommand.args, {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  fail(
    `Failed to start the underlying skill command: ${result.error.message}`,
    directCommand,
  );
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

fail(
  `The underlying skill command exited without a status${
    result.signal ? ` (signal: ${result.signal})` : ""
  }.`,
  directCommand,
);
