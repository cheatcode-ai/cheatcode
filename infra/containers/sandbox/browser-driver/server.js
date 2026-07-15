import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Stagehand } from "@browserbasehq/stagehand";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
const BOOTSTRAP_TIMEOUT_MS = 30_000;
const MAX_BOOTSTRAP_BYTES = 64_000;
const MAX_LIFETIME_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 500_000;
const MAX_PENDING_ACTION_BATCHES = 8;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 11 * 60 * 1000;
const bootstrap = await readBootstrapConfig();
const PORT = bootstrap.port;
const MODEL_NAME = bootstrap.modelName || DEFAULT_MODEL;
const MODEL_API_KEY = bootstrap.modelApiKey;
const CREDENTIAL_FINGERPRINT = bootstrap.credentialFingerprint;
const DRIVER_TOKEN = bootstrap.driverToken;
const RUN_ID = bootstrap.runId;

for (const name of [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_KEY",
  "CHEATCODE_BROWSER_DRIVER_TOKEN",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENAI_API_KEY",
  "STAGEHAND_MODEL_API_KEY",
]) {
  delete process.env[name];
}

let stagehandPromise;
let actionQueue = Promise.resolve();
let pendingActionBatches = 0;

async function readBootstrapConfig() {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let timer;
  try {
    const line = await Promise.race([
      input[Symbol.asyncIterator]().next(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Browser driver bootstrap input timed out")),
          BOOTSTRAP_TIMEOUT_MS,
        );
      }),
    ]);
    if (line.done || typeof line.value !== "string") {
      throw new Error("Browser driver bootstrap input is missing");
    }
    if (Buffer.byteLength(line.value) > MAX_BOOTSTRAP_BYTES) {
      throw new Error("Browser driver bootstrap input is too large");
    }
    return validateBootstrapConfig(JSON.parse(line.value));
  } finally {
    clearTimeout(timer);
    input.close();
  }
}

function validateBootstrapConfig(value) {
  if (!isRecord(value)) {
    throw new Error("Browser driver bootstrap input is invalid");
  }
  const now = Date.now();
  const isValid =
    Number.isInteger(value.port) &&
    value.port >= 1_024 &&
    value.port <= 65_535 &&
    typeof value.modelName === "string" &&
    value.modelName.length > 0 &&
    value.modelName.length <= 200 &&
    typeof value.modelApiKey === "string" &&
    value.modelApiKey.length > 0 &&
    value.modelApiKey.length <= 32_000 &&
    typeof value.credentialFingerprint === "string" &&
    /^[a-f0-9]{32}$/u.test(value.credentialFingerprint) &&
    typeof value.driverToken === "string" &&
    /^[a-f0-9]{64}$/u.test(value.driverToken) &&
    typeof value.runId === "string" &&
    value.runId.length > 0 &&
    value.runId.length <= 200 &&
    Number.isInteger(value.expiresAtMs) &&
    value.expiresAtMs > now &&
    value.expiresAtMs <= now + MAX_LIFETIME_MS;
  if (!isValid) {
    throw new Error("Browser driver bootstrap input is invalid");
  }
  return value;
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function modelConfig() {
  return MODEL_API_KEY ? { apiKey: MODEL_API_KEY, modelName: MODEL_NAME } : MODEL_NAME;
}

function createStagehand() {
  return new Stagehand({
    env: "LOCAL",
    model: modelConfig(),
    localBrowserLaunchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      chromiumSandbox: false,
      connectTimeoutMs: 30000,
      executablePath: process.env.CHROME_PATH,
      headless: false,
    },
    verbose: 0,
  });
}

async function stagehandInstance() {
  stagehandPromise ??= initializeStagehand().catch((error) => {
    stagehandPromise = undefined;
    throw error;
  });
  return stagehandPromise;
}

async function initializeStagehand() {
  const stagehand = createStagehand();
  try {
    await stagehand.init();
    return stagehand;
  } catch (error) {
    await stagehand.close({ force: true }).catch(() => undefined);
    throw error;
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new RequestError(413, "Browser action payload is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runActions(stagehand, actions) {
  const results = [];

  for (const action of actions) {
    results.push(await runAction(stagehand, action));
  }

  return results;
}

async function runAction(stagehand, action) {
  const page = await stagehand.context.awaitActivePage();
  if (action.type === "goto") {
    await page.goto(action.url, { waitUntil: action.waitUntil || "domcontentloaded" });
    return { type: action.type, url: page.url() };
  }
  if (action.type === "act") {
    const result = await stagehand.act(action.instruction, {
      page,
      timeout: action.timeoutMs || 10000,
    });
    const activePage = await stagehand.context.awaitActivePage();
    return { result, type: action.type, url: activePage.url() };
  }
  if (action.type === "observe") {
    const result = await stagehand.observe(action.instruction, { page });
    return { result, type: action.type, url: page.url() };
  }
  if (action.type === "extract") {
    const result = await stagehand.extract(action.instruction, { page });
    return { result, type: action.type, url: page.url() };
  }
  if (action.type !== "screenshot") {
    throw new Error(`Unsupported browser action type: ${action.type}`);
  }
  const buffer = await page.screenshot({ fullPage: Boolean(action.fullPage), type: "png" });
  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new RequestError(413, "Browser screenshot is too large");
  }
  return {
    base64: buffer.toString("base64"),
    mediaType: "image/png",
    type: action.type,
    url: page.url(),
  };
}

function runActionsSerialized(actions) {
  if (pendingActionBatches >= MAX_PENDING_ACTION_BATCHES) {
    throw new RequestError(429, "Browser action queue is full");
  }
  pendingActionBatches += 1;
  const result = actionQueue.then(async () => {
    const stagehand = await stagehandInstance();
    return runActions(stagehand, actions);
  });
  actionQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result.finally(() => {
    pendingActionBatches -= 1;
  });
}

function isAuthorized(request) {
  const authorization = request.headers.authorization || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const suppliedRunId = request.headers["x-cheatcode-run-id"];
  if (!DRIVER_TOKEN || !RUN_ID || suppliedRunId !== RUN_ID) {
    return false;
  }
  const expected = Buffer.from(DRIVER_TOKEN);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function jsonResponse(response, status, value) {
  let body = JSON.stringify(value);
  if (status < 400 && Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    status = 413;
    body = JSON.stringify({ error: "browser_driver_response_too_large", ok: false });
  }
  response.writeHead(status, {
    "content-length": String(Buffer.byteLength(body)),
    "content-type": "application/json",
  });
  response.end(body);
}

function parseActionsInput(rawBody) {
  let input;
  try {
    input = rawBody.trim() ? JSON.parse(rawBody) : null;
  } catch {
    throw new RequestError(400, "Browser action payload is not valid JSON");
  }
  if (!isRecord(input) || !Array.isArray(input.actions)) {
    throw new RequestError(400, "Browser actions must be an array");
  }
  if (input.actions.length < 1 || input.actions.length > 10) {
    throw new RequestError(400, "Browser action batches must contain 1 to 10 actions");
  }
  return input.actions.map(validateAction);
}

function validateAction(action) {
  if (!isRecord(action) || typeof action.type !== "string") {
    throw new RequestError(400, "Browser action is invalid");
  }
  if (action.type === "goto") {
    assertHttpUrl(action.url);
    if (
      action.waitUntil !== undefined &&
      !["load", "domcontentloaded", "networkidle"].includes(action.waitUntil)
    ) {
      throw new RequestError(400, "Browser navigation wait strategy is invalid");
    }
    return action;
  }
  if (action.type === "act") {
    assertInstruction(action.instruction);
    if (
      action.timeoutMs !== undefined &&
      (!Number.isInteger(action.timeoutMs) || action.timeoutMs < 1 || action.timeoutMs > 120_000)
    ) {
      throw new RequestError(400, "Browser action timeout is invalid");
    }
    return action;
  }
  if (action.type === "observe" || action.type === "extract") {
    assertInstruction(action.instruction);
    return action;
  }
  if (action.type === "screenshot") {
    if (action.fullPage !== undefined && typeof action.fullPage !== "boolean") {
      throw new RequestError(400, "Browser screenshot option is invalid");
    }
    return action;
  }
  throw new RequestError(400, "Browser action type is unsupported");
}

function assertHttpUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new RequestError(400, "Browser navigation URL is invalid");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new RequestError(400, "Browser navigation URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RequestError(400, "Browser navigation only supports HTTP and HTTPS");
  }
}

function assertInstruction(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_000) {
    throw new RequestError(400, "Browser action instruction is invalid");
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/ready") {
      jsonResponse(response, 200, { ok: true });
      return;
    }

    if (!isAuthorized(request)) {
      jsonResponse(response, 401, { error: "unauthorized", ok: false });
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      const stagehand = await stagehandInstance();
      stagehand.connectURL();
      if (!stagehand.context?.activePage()) {
        throw new Error("Browser driver has no active page");
      }
      jsonResponse(response, 200, {
        credentialFingerprint: CREDENTIAL_FINGERPRINT,
        model: MODEL_NAME,
        ok: true,
        runId: RUN_ID,
      });
      return;
    }

    if (request.method === "POST" && request.url === "/actions") {
      const rawBody = await readBody(request);
      const actions = parseActionsInput(rawBody);
      const results = await runActionsSerialized(actions);
      jsonResponse(response, 200, { ok: true, results });
      return;
    }

    jsonResponse(response, 404, { error: "not_found", ok: false });
  } catch (error) {
    const isRequestError = error instanceof RequestError;
    jsonResponse(response, isRequestError ? error.status : 500, {
      error: isRequestError ? error.message : "Browser driver request failed",
      ok: false,
    });
  }
});

server.listen(PORT, "0.0.0.0");
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
const lifetimeTimer = setTimeout(() => void shutdown(), bootstrap.expiresAtMs - Date.now());
lifetimeTimer.unref();

async function shutdown() {
  clearTimeout(lifetimeTimer);
  server.close();
  if (stagehandPromise) {
    const stagehand = await stagehandPromise.catch(() => null);
    await stagehand?.close().catch(() => undefined);
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
