#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const [runtimeModules] = process.argv.slice(2);
if (!runtimeModules || !isAbsolute(runtimeModules)) {
  throw new TypeError("Expo runtime configuration requires an absolute immutable module path");
}

const configPath = join(process.cwd(), "tsconfig.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!isRecord(config)) {
  throw new TypeError("Expo tsconfig.json must contain a JSON object");
}

// The checksum-pinned Expo template owns its source aliases. Node's normal module resolution follows
// the project node_modules link, so TypeScript needs only the immutable Expo base configuration.
config.extends = join(runtimeModules, "expo/tsconfig.base");

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
