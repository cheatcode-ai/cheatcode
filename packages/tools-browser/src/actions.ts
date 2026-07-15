import { APIError } from "@cheatcode/observability";
import { type ArtifactUploadResult, callSandboxMethod } from "@cheatcode/sandbox-contracts";
import { z } from "zod";
import type { BrowserRuntimeContext } from "./runtime";
import { BrowserRuntimeContextSchema } from "./runtime";

const DRIVER_PROCESS_PREFIX = "cheatcode-browser-driver-";
const DRIVER_LAUNCHER_PATH = "/usr/local/bin/cheatcode-browser-driver";
const DRIVER_PORT_BASE = 20_000;
const DRIVER_PORT_MAX = 59_999;
const DRIVER_LIFETIME_MS = 55 * 60 * 1000;
const START_BROWSER_SCRIPT = "/opt/cheatcode/start-browser.sh";
const MAX_DRIVER_PAYLOAD_BYTES = 500_000;
const MAX_DRIVER_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_BROWSER_RESULT_BYTES = 160 * 1024;
const MAX_BROWSER_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const MAX_BROWSER_SCREENSHOT_BASE64_CHARACTERS = Math.ceil(MAX_BROWSER_SCREENSHOT_BYTES / 3) * 4;
const DRIVER_REQUEST_OVERHEAD_MS = 30_000;
const DRIVER_REQUEST_MAX_MS = 600_000;

interface BrowserDriverConnection {
  authToken: string;
  credentialFingerprint: string;
  port: number;
  processId: string;
  runId: string;
}

interface BrowserDriverHttpResult {
  body: unknown;
  ok: boolean;
  status: number;
}

const WaitUntilSchema = z.enum(["load", "domcontentloaded", "networkidle"]);
const BrowserUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine(isHttpUrl, "Browser navigation only supports HTTP and HTTPS URLs.");

export const BrowserOpenInputSchema = z
  .object({
    url: BrowserUrlSchema.describe("URL to open in the sandbox browser."),
    waitUntil: WaitUntilSchema.default("domcontentloaded").describe("Navigation wait strategy."),
  })
  .strict();

export const BrowserActInputSchema = z
  .object({
    instruction: z.string().min(1).max(2_000).describe("Natural-language browser action."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(120_000)
      .default(10_000)
      .describe("Maximum time for this browser action."),
  })
  .strict();

export const BrowserObserveInputSchema = z
  .object({
    instruction: z.string().min(1).max(2_000).describe("What to observe on the current page."),
  })
  .strict();

export const BrowserExtractInputSchema = z
  .object({
    instruction: z
      .string()
      .min(1)
      .max(2_000)
      .describe("What information to extract from the current page."),
  })
  .strict();

export const BrowserScreenshotInputSchema = z
  .object({
    fullPage: z.boolean().default(false).describe("Capture the full page when true."),
  })
  .strict();

const BrowserActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("goto"),
      url: BrowserUrlSchema,
      waitUntil: WaitUntilSchema.default("domcontentloaded"),
    })
    .strict(),
  z
    .object({
      type: z.literal("act"),
      instruction: z.string().min(1).max(2_000),
      timeoutMs: z.number().int().positive().max(120_000).default(10_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("observe"),
      instruction: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("extract"),
      instruction: z.string().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("screenshot"),
      fullPage: z.boolean().default(false),
    })
    .strict(),
]);

const BrowserActionsInputSchema = z
  .object({
    actions: z.array(BrowserActionSchema).min(1).max(10),
  })
  .strict();

const BrowserArtifactSchema = z
  .object({
    downloadUrl: z.string().url().max(2_048),
    filename: z.string().min(1).max(200),
    kind: z.literal("image"),
    mimeType: z.literal("image/png"),
    outputId: z.string().min(1).max(500),
    r2Key: z.string().min(1).max(2_048),
    sizeBytes: z.number().int().nonnegative().max(MAX_BROWSER_SCREENSHOT_BYTES),
  })
  .strict();

const BrowserActionResultSchema = z
  .object({
    artifact: BrowserArtifactSchema.optional(),
    result: z
      .unknown()
      .refine((value) => serializedSizeWithin(value, MAX_BROWSER_RESULT_BYTES), {
        message: "Browser action result is too large.",
      })
      .optional(),
    type: z.enum(["goto", "act", "observe", "extract", "screenshot"]),
    url: z.string().max(2_048).optional(),
  })
  .strict();

export const BrowserActionsOutputSchema = z
  .object({
    ok: z.literal(true),
    results: z.array(BrowserActionResultSchema).max(10),
  })
  .strict();

const BrowserDriverActionResultSchema = z
  .object({
    base64: z.string().max(MAX_BROWSER_SCREENSHOT_BASE64_CHARACTERS).optional(),
    mediaType: z.string().max(100).optional(),
    result: z.unknown().optional(),
    type: z.enum(["goto", "act", "observe", "extract", "screenshot"]),
    url: z.string().max(2_048).optional(),
  })
  .strip();

const BrowserDriverActionsOutputSchema = z
  .object({
    ok: z.literal(true),
    results: z.array(BrowserDriverActionResultSchema).max(10),
  })
  .strip();

const BrowserDriverErrorSchema = z
  .object({
    error: z.string().max(1_000),
    ok: z.literal(false),
  })
  .strip();

type BrowserOpenInput = z.input<typeof BrowserOpenInputSchema>;
type BrowserActInput = z.input<typeof BrowserActInputSchema>;
type BrowserObserveInput = z.input<typeof BrowserObserveInputSchema>;
type BrowserExtractInput = z.input<typeof BrowserExtractInputSchema>;
type BrowserScreenshotInput = z.input<typeof BrowserScreenshotInputSchema>;
type BrowserActionsInput = z.input<typeof BrowserActionsInputSchema>;
type BrowserActionsOutput = z.infer<typeof BrowserActionsOutputSchema>;
type BrowserActionResult = BrowserActionsOutput["results"][number];
type BrowserDriverActionResult = z.infer<typeof BrowserDriverActionResultSchema>;

export async function executeBrowserOpen(
  input: BrowserOpenInput,
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionsOutput> {
  const parsedInput = BrowserOpenInputSchema.parse(input);
  return executeBrowserActions(
    { actions: [{ type: "goto", url: parsedInput.url, waitUntil: parsedInput.waitUntil }] },
    runtimeContext,
  );
}

export async function executeBrowserAct(
  input: BrowserActInput,
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionsOutput> {
  const parsedInput = BrowserActInputSchema.parse(input);
  return executeBrowserActions(
    {
      actions: [
        {
          type: "act",
          instruction: parsedInput.instruction,
          timeoutMs: parsedInput.timeoutMs,
        },
      ],
    },
    runtimeContext,
  );
}

export async function executeBrowserObserve(
  input: BrowserObserveInput,
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionsOutput> {
  const parsedInput = BrowserObserveInputSchema.parse(input);
  return executeBrowserActions(
    { actions: [{ type: "observe", instruction: parsedInput.instruction }] },
    runtimeContext,
  );
}

export async function executeBrowserExtract(
  input: BrowserExtractInput,
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionsOutput> {
  const parsedInput = BrowserExtractInputSchema.parse(input);
  return executeBrowserActions(
    { actions: [{ type: "extract", instruction: parsedInput.instruction }] },
    runtimeContext,
  );
}

export async function executeBrowserScreenshot(
  input: BrowserScreenshotInput,
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionsOutput> {
  const parsedInput = BrowserScreenshotInputSchema.parse(input);
  return executeBrowserActions(
    { actions: [{ type: "screenshot", fullPage: parsedInput.fullPage }] },
    runtimeContext,
  );
}

async function executeBrowserActions(
  input: BrowserActionsInput,
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionsOutput> {
  const parsedInput = BrowserActionsInputSchema.parse(input);
  const parsedRuntime = BrowserRuntimeContextSchema.parse(runtimeContext);
  await callSandboxMethod(parsedRuntime.sandbox, "exec", {
    command: [START_BROWSER_SCRIPT],
    timeoutMs: 30_000,
  });
  const connection = await browserDriverConnection(parsedRuntime);
  await ensureBrowserDriverServer(parsedRuntime, connection);
  return postBrowserActions(parsedInput, parsedRuntime, connection);
}

async function requestBrowserDriver(
  input: BrowserActionsInput | null,
  path: string,
  runtimeContext: BrowserRuntimeContext,
  connection: BrowserDriverConnection,
  timeoutMs: number,
): Promise<BrowserDriverHttpResult> {
  const payload = browserDriverPayload(input);
  const signedUrl = await signedBrowserDriverUrl(runtimeContext, connection.port, timeoutMs);
  const response = await fetchBrowserDriver(signedUrl, path, payload, connection, timeoutMs);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DRIVER_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw driverResponseTooLargeError();
  }
  const body = parseBrowserDriverJson(await readBoundedDriverResponse(response));
  return { body, ok: response.ok, status: response.status };
}

function browserDriverPayload(input: BrowserActionsInput | null): string {
  const payload = input ? JSON.stringify(BrowserActionsInputSchema.parse(input)) : "";
  if (new TextEncoder().encode(payload).byteLength > MAX_DRIVER_PAYLOAD_BYTES) {
    throw new APIError(400, "tool_validation_failed", "Browser action payload is too large", {
      hint: "Split the browser task into smaller actions.",
      retriable: false,
    });
  }
  return payload;
}

async function signedBrowserDriverUrl(
  runtimeContext: BrowserRuntimeContext,
  port: number,
  timeoutMs: number,
): Promise<string> {
  if (!runtimeContext.sandbox.getSignedPreviewUrl) {
    throw new APIError(
      500,
      "validation_tool_not_registered",
      "Sandbox signed preview URLs are unavailable.",
      { retriable: false },
    );
  }
  const signed = await runtimeContext.sandbox.getSignedPreviewUrl({
    expiresInSeconds: Math.max(60, Math.ceil(timeoutMs / 1000) + 30),
    port,
  });
  return signed.url;
}

async function fetchBrowserDriver(
  signedUrl: string,
  path: string,
  payload: string,
  connection: BrowserDriverConnection,
  timeoutMs: number,
): Promise<Response> {
  try {
    const requestInit: RequestInit = {
      headers: {
        authorization: `Bearer ${connection.authToken}`,
        "content-type": "application/json",
        "x-cheatcode-run-id": connection.runId,
      },
      method: payload ? "POST" : "GET",
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (payload) {
      requestInit.body = payload;
    }
    return await fetch(new URL(path, signedUrl), requestInit);
  } catch (error) {
    throw new APIError(502, "tool_execution_failed", "Sandbox browser driver is unreachable", {
      cause: error,
      hint: "Restart the sandbox browser tool and retry the browser action.",
      retriable: true,
    });
  }
}

function parseBrowserDriverJson(responseText: string): unknown {
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    throw new APIError(
      502,
      "tool_execution_failed",
      "Sandbox browser driver returned invalid JSON",
      {
        hint: "Check the sandbox browser driver logs.",
        retriable: true,
      },
    );
  }
}

async function readBoundedDriverResponse(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_DRIVER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw driverResponseTooLargeError();
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

function driverResponseTooLargeError(): APIError {
  return new APIError(
    502,
    "tool_execution_failed",
    "Sandbox browser driver response is too large",
    {
      retriable: false,
    },
  );
}

async function ensureBrowserDriverServer(
  runtimeContext: BrowserRuntimeContext,
  connection: BrowserDriverConnection,
): Promise<void> {
  if (await browserDriverServerIsHealthy(runtimeContext, connection)) {
    return;
  }
  await stopBrowserDriverServer(runtimeContext, connection.processId);
  connection.port = await reserveBrowserDriverPort(runtimeContext, connection.processId);
  await callSandboxMethod(runtimeContext.sandbox, "startProcess", {
    command: ["sudo", "-n", "-H", "-u", "cheatcode-browser", "--", DRIVER_LAUNCHER_PATH],
    cwd: "/workspace",
    processId: connection.processId,
    stdin: `${JSON.stringify(browserDriverBootstrap(runtimeContext, connection))}\n`,
    waitForPort: {
      path: "/ready",
      port: connection.port,
      timeoutMs: 60_000,
    },
  });
}

async function stopBrowserDriverServer(
  runtimeContext: BrowserRuntimeContext,
  processId: string,
): Promise<void> {
  await callSandboxMethod(runtimeContext.sandbox, "killProcess", {
    processId,
  }).catch(() => undefined);
}

async function browserDriverServerIsHealthy(
  runtimeContext: BrowserRuntimeContext,
  connection: BrowserDriverConnection,
): Promise<boolean> {
  try {
    const result = await requestBrowserDriver(null, "/health", runtimeContext, connection, 90_000);
    const parsed = BrowserDriverHealthSchema.safeParse(result.body);
    return (
      result.ok &&
      parsed.success &&
      parsed.data.credentialFingerprint === connection.credentialFingerprint &&
      parsed.data.runId === connection.runId &&
      parsed.data.model === stagehandModel(runtimeContext.credential)
    );
  } catch {
    return false;
  }
}

async function postBrowserActions(
  input: BrowserActionsInput,
  runtimeContext: BrowserRuntimeContext,
  connection: BrowserDriverConnection,
): Promise<BrowserActionsOutput> {
  const result = await requestBrowserDriver(
    input,
    "/actions",
    runtimeContext,
    connection,
    browserDriverRequestTimeoutMs(input),
  );
  const parsedOutput = requireBrowserDriverOutput(result);
  const normalizedResults = await normalizeBrowserActionResults(
    parsedOutput.results,
    runtimeContext,
  );
  return validateBrowserActionsOutput(normalizedResults);
}

function requireBrowserDriverOutput(result: BrowserDriverHttpResult) {
  if (!result.ok) {
    const driverError = BrowserDriverErrorSchema.safeParse(result.body);
    throw new APIError(502, "tool_execution_failed", "Sandbox browser driver request failed", {
      details: {
        responseShape: driverError.success ? "recognized" : "invalid",
        status: result.status,
      },
      hint: "Restart the sandbox browser tool and retry the browser action.",
      retriable: true,
    });
  }
  const parsedOutput = BrowserDriverActionsOutputSchema.safeParse(result.body);
  if (!parsedOutput.success) {
    throw new APIError(
      502,
      "tool_execution_failed",
      "Sandbox browser driver returned invalid output",
      {
        cause: parsedOutput.error,
        hint: "Check the sandbox browser driver logs.",
        retriable: true,
      },
    );
  }
  return parsedOutput.data;
}

async function normalizeBrowserActionResults(
  actions: BrowserDriverActionResult[],
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionResult[]> {
  const normalizedResults: BrowserActionResult[] = [];
  for (const [index, action] of actions.entries()) {
    normalizedResults.push(await normalizeBrowserActionResult(action, index, runtimeContext));
  }
  return normalizedResults;
}

function validateBrowserActionsOutput(
  normalizedResults: BrowserActionResult[],
): BrowserActionsOutput {
  const output = {
    ok: true,
    results: normalizedResults,
  } as const;
  const parsed = BrowserActionsOutputSchema.safeParse(output);
  if (parsed.success) {
    return parsed.data;
  }
  throw new APIError(502, "tool_execution_failed", "Sandbox browser output is too large", {
    hint: "Retry with a narrower browser extraction instruction.",
    retriable: false,
  });
}

async function normalizeBrowserActionResult(
  action: BrowserDriverActionResult,
  index: number,
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionResult> {
  if (action.type !== "screenshot") {
    if (
      action.result !== undefined &&
      !serializedSizeWithin(action.result, MAX_BROWSER_RESULT_BYTES)
    ) {
      throw new APIError(502, "tool_execution_failed", "Browser extraction result is too large", {
        hint: "Retry with a narrower browser extraction instruction.",
        retriable: false,
      });
    }
    return {
      ...(action.result === undefined ? {} : { result: action.result }),
      type: action.type,
      ...(action.url ? { url: action.url } : {}),
    };
  }
  if (!action.base64 || action.mediaType !== "image/png") {
    throw invalidDriverScreenshot();
  }
  if (!runtimeContext.artifacts) {
    throw new APIError(500, "internal_error", "Browser artifact storage is unavailable", {
      retriable: false,
    });
  }
  const bytes = decodeScreenshot(action.base64);
  const artifact = await runtimeContext.artifacts.put({
    contentType: "image/png",
    data: bytes,
    filename: `browser-screenshot-${index + 1}-${crypto.randomUUID()}.png`,
    kind: "image",
    metadata: {
      ...(action.url ? { sourceUrl: action.url } : {}),
    },
  });
  return {
    artifact: browserArtifactResult(artifact),
    type: action.type,
    ...(action.url ? { url: action.url } : {}),
  };
}

function browserArtifactResult(
  artifact: ArtifactUploadResult,
): z.infer<typeof BrowserArtifactSchema> {
  return BrowserArtifactSchema.parse(artifact);
}

function decodeScreenshot(base64: string): Uint8Array {
  if (base64.length > MAX_BROWSER_SCREENSHOT_BASE64_CHARACTERS) {
    throw invalidDriverScreenshot();
  }
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw invalidDriverScreenshot();
  }
  if (binary.length > MAX_BROWSER_SCREENSHOT_BYTES) {
    throw invalidDriverScreenshot();
  }
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function invalidDriverScreenshot(): APIError {
  return new APIError(502, "tool_execution_failed", "Sandbox browser returned an invalid image", {
    retriable: true,
  });
}

const BrowserDriverHealthSchema = z
  .object({
    credentialFingerprint: z.string().min(16),
    model: z.string().min(1),
    ok: z.literal(true),
    runId: z.string().min(1),
  })
  .strict();

function stagehandModel(credential: BrowserRuntimeContext["credential"]): string {
  return `${credential.provider}/${credential.modelId}`;
}

function browserDriverBootstrap(
  runtimeContext: BrowserRuntimeContext,
  connection: BrowserDriverConnection,
): Record<string, number | string> {
  return {
    credentialFingerprint: connection.credentialFingerprint,
    driverToken: connection.authToken,
    expiresAtMs: Date.now() + DRIVER_LIFETIME_MS,
    modelApiKey: runtimeContext.credential.apiKey,
    modelName: stagehandModel(runtimeContext.credential),
    port: connection.port,
    runId: connection.runId,
  };
}

async function fingerprintCredential(apiKey: string): Promise<string> {
  return [...(await sha256Bytes(apiKey))]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function browserDriverConnection(
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserDriverConnection> {
  const processId = browserDriverProcessId(runtimeContext.runId);
  const port = await reserveBrowserDriverPort(runtimeContext, processId);
  return {
    authToken: await driverAuthToken(runtimeContext),
    credentialFingerprint: await fingerprintCredential(runtimeContext.credential.apiKey),
    port,
    processId,
    runId: runtimeContext.runId,
  };
}

async function reserveBrowserDriverPort(
  runtimeContext: BrowserRuntimeContext,
  processId: string,
): Promise<number> {
  if (!runtimeContext.sandbox.allocateProcessPort) {
    throw new APIError(
      500,
      "validation_tool_not_registered",
      "Sandbox process port allocator is missing.",
      { retriable: false },
    );
  }
  return runtimeContext.sandbox.allocateProcessPort({
    maxPort: DRIVER_PORT_MAX,
    minPort: DRIVER_PORT_BASE,
    processId,
  });
}

function browserDriverProcessId(runId: string): string {
  const safeRunId = runId.replaceAll(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
  return `${DRIVER_PROCESS_PREFIX}${safeRunId}`;
}

async function driverAuthToken(runtimeContext: BrowserRuntimeContext): Promise<string> {
  const bytes = await sha256Bytes(
    `${runtimeContext.runId}\0${runtimeContext.credential.apiKey}\0cheatcode-browser-driver`,
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function browserDriverRequestTimeoutMs(input: BrowserActionsInput): number {
  const actionTimeoutMs = input.actions.reduce(
    (total, action) => total + (action.type === "act" ? (action.timeoutMs ?? 10_000) : 30_000),
    DRIVER_REQUEST_OVERHEAD_MS,
  );
  return Math.min(actionTimeoutMs, DRIVER_REQUEST_MAX_MS);
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function isHttpUrl(value: string): boolean {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}

function serializedSizeWithin(value: unknown, maxBytes: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && new TextEncoder().encode(serialized).byteLength <= maxBytes;
  } catch {
    return false;
  }
}
