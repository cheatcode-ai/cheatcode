#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = process.argv.slice(2);
const forwarded = input[0] === "--cloud" ? input.slice(1) : input;

if (forwarded[0] === "get_live_preview_link") {
  await requestBrowserHandoff("live-preview");
  process.exit(0);
}

if (forwarded[0] === "request_user_control") {
  await requestBrowserHandoff("request-user-control");
  process.exit(0);
}

const result = spawnSync(
  "agent-browser",
  ["--auto-connect", "--session", process.env.CHEATCODE_RUN_ID || "cheatcode-sandbox", ...forwarded],
  {
    env: {
      ...process.env,
      AGENT_BROWSER_EXECUTABLE_PATH:
        process.env.AGENT_BROWSER_EXECUTABLE_PATH || process.env.CHROME_PATH || "",
    },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`Failed to start Cheatcode browser: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

async function requestBrowserHandoff(operation) {
  const configPath =
    process.env.CHEATCODE_SKILL_RUNTIME_CONFIG ||
    "/workspace/.cheatcode/runtime/skill-runtime-config.json";
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error("The active Cheatcode run has no browser handoff configuration.");
  }
  const response = await fetch(
    `${String(config.backendBaseUrl).replace(/\/+$/, "")}/browser/${operation}`,
    {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || "Browser handoff failed.";
    throw new Error(message);
  }
  console.log(
    JSON.stringify({
      action: operation === "live-preview" ? "get_live_preview_link" : "request_user_control",
      data: {
        livePreviewUrl: payload.url || null,
        sessionId: payload.takeoverId || null,
        ...payload,
      },
    }),
  );
}
