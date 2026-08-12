import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Stagehand } from "@browserbasehq/stagehand";
import { launch as launchChrome } from "chrome-launcher";
import { z } from "zod";
import {
  installBrowserConnectionGuard,
  installOriginInterceptor,
} from "./origin-guard.js";

const BOOTSTRAP_TIMEOUT_MS = 30_000;
const MAX_BOOTSTRAP_BYTES = 64_000;
const MAX_CDP_RESPONSE_BYTES = 64_000;
const MAX_LIFETIME_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 500_000;
const MAX_PENDING_ACTION_BATCHES = 8;
const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024;
// An 8 MiB PNG expands to roughly 10.7 MiB as base64 before JSON framing.
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const REQUEST_BODY_TIMEOUT_MS = 30 * 1000;
const ObservedActionSchema = z.strictObject({
  arguments: z.array(z.string().max(2_000)).max(10).optional(),
  backendNodeId: z.number().int().positive().optional(),
  description: z.string().min(1).max(2_000),
  method: z.enum([
    "click",
    "doubleClick",
    "dragAndDrop",
    "fill",
    "hover",
    "nextChunk",
    "press",
    "prevChunk",
    "scrollTo",
    "selectOptionFromDropdown",
    "type",
  ]),
  selector: z.string().min(1).max(4_096).startsWith("xpath="),
});
const bootstrap = await readBootstrapConfig();
const PORT = bootstrap.port;
const MODEL_NAME = bootstrap.modelName;
const MODEL_API_KEY = bootstrap.modelApiKey;
const CREDENTIAL_FINGERPRINT = bootstrap.credentialFingerprint;
const DRIVER_TOKEN = bootstrap.driverToken;
const RUN_ID = bootstrap.runId;
const PROVIDER_API_HOSTNAME = providerApiHostname(MODEL_NAME);
const UPSTREAM_FETCH = globalThis.fetch.bind(globalThis);

// Stagehand's current AI SDK line has no patched release for GHSA-866g-f22w-33x8.
// Inject a bounded provider-only transport into its AI SDK client. Stagehand's
// Chromium/CDP transport deliberately retains the native fetch implementation.

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

let browserRuntimePromise;
let browserRuntimeStatus = "initializing";
let ownedChrome;
let ownedStagehand;
let shutdownPromise;
let actionQueue = Promise.resolve();
let pendingActionBatches = 0;
let latestObservation;

async function boundedProviderFetch(input, init) {
  assertProviderRequestUrl(input);
  const response = await UPSTREAM_FETCH(input, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Browser model provider redirects are not allowed");
  }
  if (!response.body || isStreamingResponse(response)) {
    return response;
  }
  await rejectOversizedDeclaredResponse(response);
  return new Response(limitProviderResponseBody(response.body), response);
}

function assertProviderRequestUrl(input) {
  const url = new URL(input instanceof Request ? input.url : input);
  if (
    url.protocol !== "https:" ||
    url.hostname !== PROVIDER_API_HOSTNAME ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error("Browser model request was outside its provider API boundary");
  }
}

function providerApiHostname(modelName) {
  const provider = modelName.split("/", 1)[0];
  if (provider === "anthropic") return "api.anthropic.com";
  if (provider === "google") return "generativelanguage.googleapis.com";
  if (provider === "openai") return "api.openai.com";
  throw new Error("Browser model provider is unsupported");
}

function isStreamingResponse(response) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "text/event-stream" || contentType === "application/x-ndjson";
}

async function rejectOversizedDeclaredResponse(response) {
  const rawLength = response.headers.get("content-length");
  const length = rawLength ? Number(rawLength) : 0;
  if (Number.isSafeInteger(length) && length > MAX_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Provider response exceeded the non-streaming response safety limit");
  }
}

function limitProviderResponseBody(body) {
  let receivedBytes = 0;
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_PROVIDER_RESPONSE_BYTES) {
          controller.error(
            new Error("Provider response exceeded the non-streaming response safety limit"),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

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
    /^(?:anthropic|google|openai)\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,188}$/u.test(value.modelName) &&
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
  return { apiKey: MODEL_API_KEY, fetch: boundedProviderFetch, modelName: MODEL_NAME };
}

function createStagehand(cdpUrl) {
  return new Stagehand({
    env: "LOCAL",
    model: modelConfig(),
    localBrowserLaunchOptions: {
      cdpUrl,
      connectTimeoutMs: 30000,
      viewport: { height: 711, width: 1288 },
    },
    selfHeal: false,
    verbose: 0,
  });
}

async function browserRuntime() {
  return browserRuntimePromise ?? startBrowserRuntime();
}

function startBrowserRuntime() {
  browserRuntimeStatus = "initializing";
  const pending = initializeBrowserRuntime();
  browserRuntimePromise = pending;
  void pending.then(
    () => {
      if (browserRuntimePromise === pending) browserRuntimeStatus = "ready";
    },
    (error) => {
      if (browserRuntimePromise !== pending) return;
      browserRuntimeStatus = "failed";
      writeDriverDiagnostic("browser_driver_initialization_failed", error);
      setTimeout(() => void shutdown(1), 0);
    },
  );
  return pending;
}

async function initializeBrowserRuntime() {
  const chrome = await launchOwnedChrome();
  ownedChrome = chrome;
  let stagehand;
  try {
    stagehand = createStagehand(await readChromeWebSocketUrl(chrome.port));
    ownedStagehand = stagehand;
    await stagehand.init();
    await installBrowserConnectionGuard(stagehand.context);
    return { chrome, stagehand };
  } catch (error) {
    await stagehand?.close({ force: true }).catch(() => undefined);
    if (ownedStagehand === stagehand) ownedStagehand = undefined;
    if (ownedChrome === chrome) ownedChrome = undefined;
    killChrome(chrome);
    throw error;
  }
}

async function closeBrowserRuntime(runtime) {
  await runtime.stagehand.close({ force: true }).catch(() => undefined);
  if (ownedStagehand === runtime.stagehand) ownedStagehand = undefined;
  if (ownedChrome === runtime.chrome) ownedChrome = undefined;
  killChrome(runtime.chrome);
}

function killChrome(chrome) {
  try {
    chrome.kill();
  } catch {
    // The browser may already have exited.
  }
}

async function launchOwnedChrome() {
  return launchChrome({
    chromeFlags: [
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--site-per-process",
      "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
      "--window-size=1288,798",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    chromePath: process.env.CHROME_PATH,
    handleSIGINT: false,
  });
}

async function readChromeWebSocketUrl(port) {
  const response = await UPSTREAM_FETCH(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Chromium CDP version endpoint was unavailable");
  }
  const body = await readBoundedResponseText(response, MAX_CDP_RESPONSE_BYTES);
  const value = JSON.parse(body);
  return validateChromeWebSocketUrl(value?.webSocketDebuggerUrl, port);
}

async function readBoundedResponseText(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Chromium CDP response exceeded its size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Chromium CDP response exceeded its size limit");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validateChromeWebSocketUrl(value, port) {
  if (typeof value !== "string") throw new Error("Chromium CDP WebSocket URL is missing");
  const url = new URL(value);
  const isValid =
    url.protocol === "ws:" &&
    url.hostname === "127.0.0.1" &&
    url.port === String(port) &&
    url.pathname.startsWith("/devtools/browser/") &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;
  if (!isValid) throw new Error("Chromium CDP WebSocket URL is invalid");
  return url.href;
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

async function runActions(runtime, actions) {
  const results = [];

  for (const action of actions) {
    results.push(await runAction(runtime, action));
  }

  return results;
}

async function runAction(runtime, action) {
  const { stagehand } = runtime;
  const page = await stagehand.context.awaitActivePage();
  if (action.type === "goto") {
    latestObservation = undefined;
    await page.goto(action.url, { waitUntil: action.waitUntil || "domcontentloaded" });
    return { type: action.type, url: page.url() };
  }
  if (action.type === "act") {
    return runGuardedAct(runtime, page, action);
  }
  if (action.type === "observe") {
    const result = await stagehand.observe(action.instruction, { page });
    latestObservation = {
      actions: result.map(normalizeObservedAction),
      url: page.url(),
    };
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

async function runGuardedAct(runtime, page, action) {
  const { stagehand } = runtime;
  assertExpectedBrowserTarget(page.url(), action.expectedUrl, action.allowedOrigin);
  const observedAction = requireObservedAction(action.action, page.url());
  latestObservation = undefined;
  let failure;
  let originInterceptor;
  let response;
  try {
    originInterceptor = await installOriginInterceptor(stagehand, action.allowedOrigin);
    await originInterceptor.assertHealthy();
    assertExpectedBrowserTarget(page.url(), action.expectedUrl, action.allowedOrigin);
    const result = await stagehand.act(observedAction, {
      page,
      timeout: action.timeoutMs || 10000,
    });
    await originInterceptor.assertHealthy();
    const activePage = await stagehand.context.awaitActivePage();
    assertAllowedBrowserOrigin(activePage.url(), action.allowedOrigin);
    response = { result, type: action.type, url: activePage.url() };
  } catch (error) {
    failure = error;
  }
  if (originInterceptor) {
    try {
      await originInterceptor.close();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) {
    await discardBrowserRuntime(runtime);
    throw failure;
  }
  return response;
}

function normalizeObservedAction(action) {
  const parsed = ObservedActionSchema.safeParse(action);
  if (!parsed.success) {
    throw new Error("Browser observation returned an invalid action");
  }
  return parsed.data;
}

function requireObservedAction(action, pageUrl) {
  const normalized = validateObservedAction(action);
  const observation = latestObservation;
  if (
    !observation ||
    observation.url !== pageUrl ||
    !observation.actions.some((candidate) => actionsEqual(candidate, normalized))
  ) {
    throw new RequestError(
      409,
      "Browser action was not returned by the latest observation for this page",
    );
  }
  return normalized;
}

function actionsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function discardBrowserRuntime(runtime) {
  const pending = browserRuntimePromise;
  browserRuntimePromise = undefined;
  browserRuntimeStatus = "initializing";
  await closeBrowserRuntime(runtime);
  if (browserRuntimePromise === undefined || browserRuntimePromise === pending) {
    void startBrowserRuntime();
  }
}

function assertExpectedBrowserTarget(actualUrl, expectedUrl, allowedOrigin) {
  if (actualUrl !== expectedUrl) {
    throw new RequestError(409, "Browser page changed before the bound action");
  }
  assertAllowedBrowserOrigin(actualUrl, allowedOrigin);
}

function assertAllowedBrowserOrigin(actualUrl, allowedOrigin) {
  let actual;
  try {
    actual = new URL(actualUrl);
  } catch {
    throw new RequestError(409, "Browser page has an invalid action origin");
  }
  if (actual.origin !== allowedOrigin) {
    throw new RequestError(409, "Browser action crossed its bound origin");
  }
}

function runActionsSerialized(actions) {
  if (pendingActionBatches >= MAX_PENDING_ACTION_BATCHES) {
    throw new RequestError(429, "Browser action queue is full");
  }
  pendingActionBatches += 1;
  const result = actionQueue.then(async () => {
    const runtime = await browserRuntime();
    return runActions(runtime, actions);
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
    action.action = validateObservedAction(action.action);
    const expectedUrl = assertHttpUrl(action.expectedUrl);
    const allowedOrigin = assertHttpUrl(action.allowedOrigin);
    if (allowedOrigin.href !== `${allowedOrigin.origin}/` || expectedUrl.origin !== allowedOrigin.origin) {
      throw new RequestError(400, "Browser action origin guard is invalid");
    }
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

function validateObservedAction(action) {
  const parsed = ObservedActionSchema.safeParse(action);
  if (!parsed.success) {
    throw new RequestError(400, "Observed browser action is invalid");
  }
  return parsed.data;
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
  if (url.username || url.password) {
    throw new RequestError(400, "Browser navigation URL cannot contain credentials");
  }
  return url;
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
      if (browserRuntimeStatus !== "ready") {
        jsonResponse(response, 503, {
          error:
            browserRuntimeStatus === "failed"
              ? "browser_driver_initialization_failed"
              : "browser_driver_initializing",
          ok: false,
        });
        return;
      }
      jsonResponse(response, 200, { ok: true });
      return;
    }

    if (!isAuthorized(request)) {
      jsonResponse(response, 401, { error: "unauthorized", ok: false });
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      const { stagehand } = await browserRuntime();
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

    if (request.method === "GET" && request.url === "/state") {
      const { stagehand } = await browserRuntime();
      const page = await stagehand.context.awaitActivePage();
      jsonResponse(response, 200, { ok: true, url: page.url() });
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
    if (!isRequestError) writeDriverDiagnostic("browser_driver_request_failed", error);
    jsonResponse(response, isRequestError ? error.status : 500, {
      error: isRequestError ? error.message : "browser_driver_request_failed",
      ok: false,
    });
  }
});

server.listen(PORT, "0.0.0.0");
server.requestTimeout = REQUEST_BODY_TIMEOUT_MS;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
void startBrowserRuntime();
const lifetimeTimer = setTimeout(() => void shutdown(0), bootstrap.expiresAtMs - Date.now());
lifetimeTimer.unref();

async function shutdown(exitCode = 0) {
  shutdownPromise ??= performShutdown(exitCode);
  return shutdownPromise;
}

async function performShutdown(exitCode) {
  clearTimeout(lifetimeTimer);
  server.close();
  const stagehand = ownedStagehand;
  const chrome = ownedChrome;
  ownedStagehand = undefined;
  ownedChrome = undefined;
  await stagehand?.close({ force: true }).catch(() => undefined);
  if (chrome) killChrome(chrome);
  process.exit(exitCode);
}

function writeDriverDiagnostic(event, error) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = sanitizeDiagnosticMessage(error instanceof Error ? error.message : String(error));
  process.stderr.write(`${JSON.stringify({ event, message, name })}\n`);
}

function sanitizeDiagnosticMessage(message) {
  let sanitized = message.slice(0, 2_000);
  for (const secret of [MODEL_API_KEY, DRIVER_TOKEN]) {
    if (secret) sanitized = sanitized.replaceAll(secret, "[redacted]");
  }
  return sanitized.replaceAll(/(?:sk|AIza)[-_A-Za-z0-9]{12,}/gu, "[redacted]");
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
