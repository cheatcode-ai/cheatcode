#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { dump, load } = require(
  "/opt/cheatcode-runtime-security-overrides/node_modules/js-yaml",
);

const REVIEWED_BUILD_POLICY = Object.freeze({
  esbuild: true,
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWorkspace(workspacePath) {
  if (!fs.existsSync(workspacePath)) {
    return { packages: ["."] };
  }
  const workspace = load(fs.readFileSync(workspacePath, "utf8")) ?? {};
  if (!isRecord(workspace)) {
    throw new TypeError("pnpm-workspace.yaml must contain a YAML object");
  }
  return workspace;
}

function mergeReviewedPolicy(workspace) {
  const configured = workspace.allowBuilds ?? {};
  if (!isRecord(configured)) {
    throw new TypeError("pnpm-workspace.yaml allowBuilds must contain a YAML object");
  }
  return {
    ...workspace,
    allowBuilds: {
      ...REVIEWED_BUILD_POLICY,
      ...configured,
    },
  };
}

function writeWorkspace(workspacePath, workspace) {
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
  const temporary = `${workspacePath}.cheatcode-build-policy-${process.pid}`;
  try {
    fs.writeFileSync(
      temporary,
      dump(workspace, { lineWidth: -1, noRefs: true, sortKeys: false }),
      { encoding: "utf8", mode: 0o600 },
    );
    fs.renameSync(temporary, workspacePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

const workspacePath = process.argv[2];
if (!workspacePath || process.argv.length !== 3) {
  throw new TypeError("usage: pnpm-build-policy.mjs <pnpm-workspace.yaml>");
}
writeWorkspace(workspacePath, mergeReviewedPolicy(readWorkspace(workspacePath)));
