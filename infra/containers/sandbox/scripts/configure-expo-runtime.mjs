#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const [localModules, runtimeModules] = process.argv.slice(2);
if (!localModules || !runtimeModules || !isAbsolute(localModules) || !isAbsolute(runtimeModules)) {
  throw new TypeError("Expo runtime configuration requires absolute local and immutable module paths");
}

const configPath = join(process.cwd(), "tsconfig.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!isRecord(config)) {
  throw new TypeError("Expo tsconfig.json must contain a JSON object");
}

const compilerOptions = isRecord(config.compilerOptions) ? config.compilerOptions : {};
const paths = isRecord(compilerOptions.paths) ? compilerOptions.paths : {};

// The checksum-pinned Expo template owns its source aliases. Runtime configuration only adds the
// disposable dependency locations; replacing the alias map would silently break template imports.
config.extends = join(runtimeModules, "expo/tsconfig.base");
config.compilerOptions = {
  ...compilerOptions,
  paths: {
    ...paths,
    "*": [`${localModules}/*`, `${runtimeModules}/*`],
  },
};

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
