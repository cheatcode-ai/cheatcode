import { APIError } from "@cheatcode/observability";
import { callSandboxMethod } from "@cheatcode/tools-code";
import { z } from "zod";
import type { BrowserCredential, BrowserRuntimeContext } from "./runtime";
import { BrowserRuntimeContextSchema } from "./runtime";

const DRIVER_PROCESS_ID = "cheatcode-browser-driver";
const DRIVER_SERVER_PATH = "/opt/cheatcode-browser-driver/server.js";
const DRIVER_SERVER_PORT = 9323;
const START_BROWSER_SCRIPT = "/opt/cheatcode/start-browser.sh";
const MAX_DRIVER_PAYLOAD_BYTES = 500_000;

const WaitUntilSchema = z.enum(["load", "domcontentloaded", "networkidle", "commit"]);

export const BrowserOpenInputSchema = z
  .object({
    url: z.string().url().describe("URL to open in the sandbox browser."),
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

export const BrowserActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("goto"),
      url: z.string().url(),
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

export const BrowserActionsInputSchema = z
  .object({
    actions: z.array(BrowserActionSchema).min(1).max(10),
  })
  .strict();

const BrowserActionResultSchema = z
  .object({
    result: z.unknown().optional(),
    type: z.string(),
    url: z.string().optional(),
  })
  .passthrough();

export const BrowserActionsOutputSchema = z
  .object({
    ok: z.boolean(),
    results: z.array(BrowserActionResultSchema),
  })
  .strict();

export type BrowserOpenInput = z.input<typeof BrowserOpenInputSchema>;
export type BrowserActInput = z.input<typeof BrowserActInputSchema>;
export type BrowserObserveInput = z.input<typeof BrowserObserveInputSchema>;
export type BrowserExtractInput = z.input<typeof BrowserExtractInputSchema>;
export type BrowserScreenshotInput = z.input<typeof BrowserScreenshotInputSchema>;
export type BrowserActionsInput = z.input<typeof BrowserActionsInputSchema>;
export type BrowserActionsOutput = z.infer<typeof BrowserActionsOutputSchema>;

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

export async function executeBrowserActions(
  input: BrowserActionsInput,
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionsOutput> {
  const parsedInput = BrowserActionsInputSchema.parse(input);
  const parsedRuntime = BrowserRuntimeContextSchema.parse(runtimeContext);
  await callSandboxMethod(parsedRuntime.sandbox, "exec", {
    command: [START_BROWSER_SCRIPT],
    timeoutMs: 30_000,
  });
  await ensureBrowserDriverServer(parsedRuntime);
  const parsedOutput = await postBrowserActions(parsedInput, parsedRuntime);
  if (!parsedOutput.ok) {
    throw new APIError(502, "tool_execution_failed", "Sandbox browser automation failed", {
      hint: "Inspect the browser instruction and retry with a smaller browser action.",
      retriable: true,
      details: {
        driver: parsedOutput,
      },
    });
  }
  return parsedOutput;
}

export function buildBrowserServerRequest(input: BrowserActionsInput | null, path: string): string {
  const payload = input ? JSON.stringify(BrowserActionsInputSchema.parse(input)) : "";
  if (payload.length > MAX_DRIVER_PAYLOAD_BYTES) {
    throw new APIError(400, "tool_validation_failed", "Browser action payload is too large", {
      hint: "Split the browser task into smaller actions.",
      retriable: false,
    });
  }
  return `const response = await fetch("http://127.0.0.1:${DRIVER_SERVER_PORT}${path}", {
  method: ${JSON.stringify(input ? "POST" : "GET")},
  headers: { "content-type": "application/json" },
  body: ${JSON.stringify(payload || undefined)},
});

const text = await response.text();
process.stdout.write(text);
if (!response.ok) {
  process.exitCode = 1;
}
`;
}

async function ensureBrowserDriverServer(runtimeContext: BrowserRuntimeContext): Promise<void> {
  const credentialFingerprint = await fingerprintCredential(runtimeContext.credential.apiKey);
  if (await browserDriverServerIsHealthy(runtimeContext, credentialFingerprint)) {
    return;
  }
  await stopBrowserDriverServer(runtimeContext);
  await callSandboxMethod(runtimeContext.sandbox, "startProcess", {
    command: ["node", DRIVER_SERVER_PATH],
    cwd: "/workspace",
    env: {
      ...stagehandEnv(runtimeContext.credential, credentialFingerprint),
      CHEATCODE_BROWSER_DRIVER_PORT: String(DRIVER_SERVER_PORT),
    },
    keepAliveTimeoutMs: 60 * 60 * 1000,
    maxRestarts: 3,
    processId: DRIVER_PROCESS_ID,
    restartOnFailure: true,
    waitForPort: {
      port: DRIVER_SERVER_PORT,
      timeoutMs: 60_000,
    },
  });
}

async function stopBrowserDriverServer(runtimeContext: BrowserRuntimeContext): Promise<void> {
  await callSandboxMethod(runtimeContext.sandbox, "killProcess", {
    processId: DRIVER_PROCESS_ID,
  }).catch(() => undefined);
}

async function browserDriverServerIsHealthy(
  runtimeContext: BrowserRuntimeContext,
  credentialFingerprint: string,
): Promise<boolean> {
  try {
    const result = await callSandboxMethod(runtimeContext.sandbox, "runCode", {
      language: "javascript",
      code: buildBrowserServerRequest(null, "/health"),
    });
    const outputText = result.stdout ?? result.output ?? "";
    const parsed = BrowserDriverHealthSchema.safeParse(parseDriverJson(outputText));
    return (
      result.success !== false &&
      !result.exitCode &&
      parsed.success &&
      parsed.data.credentialFingerprint === credentialFingerprint &&
      parsed.data.model === stagehandModel(runtimeContext.credential)
    );
  } catch {
    return false;
  }
}

async function postBrowserActions(
  input: BrowserActionsInput,
  runtimeContext: BrowserRuntimeContext,
): Promise<BrowserActionsOutput> {
  const result = await callSandboxMethod(runtimeContext.sandbox, "runCode", {
    language: "javascript",
    code: buildBrowserServerRequest(input, "/actions"),
  });
  const outputText = result.stdout ?? result.output ?? "";
  const driverResponse = parseDriverJson(outputText);
  const parsedOutput = BrowserActionsOutputSchema.safeParse(driverResponse);
  if (result.success === false || result.exitCode) {
    throw new APIError(502, "tool_execution_failed", "Sandbox browser driver request failed", {
      details: {
        driver: driverResponse,
        exitCode: result.exitCode,
        stderr: result.stderr,
      },
      hint: "Restart the sandbox browser tool and retry the browser action.",
      retriable: true,
    });
  }
  if (!parsedOutput.success) {
    throw new APIError(
      502,
      "tool_execution_failed",
      "Sandbox browser driver returned invalid output",
      {
        details: {
          driver: driverResponse,
          error: parsedOutput.error.message,
        },
        hint: "Check the sandbox browser driver logs.",
        retriable: true,
      },
    );
  }
  return parsedOutput.data;
}

function parseDriverJson(stdout: string): unknown {
  const line = stdout
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .at(-1);
  if (!line) {
    throw new APIError(502, "tool_execution_failed", "Browser driver returned no JSON output", {
      hint: "Check the sandbox browser driver logs.",
      retriable: true,
    });
  }
  return JSON.parse(line) as unknown;
}

const BrowserDriverHealthSchema = z
  .object({
    credentialFingerprint: z.string().min(16),
    model: z.string().min(1),
    ok: z.literal(true),
  })
  .strict();

function stagehandModel(credential: BrowserCredential): string {
  return `${credential.provider}/${credential.modelId}`;
}

function stagehandEnv(
  credential: BrowserCredential,
  credentialFingerprint: string,
): Record<string, string> {
  return {
    CHEATCODE_BROWSER_DRIVER_CREDENTIAL_FINGERPRINT: credentialFingerprint,
    STAGEHAND_MODEL: stagehandModel(credential),
    STAGEHAND_MODEL_API_KEY: credential.apiKey,
  };
}

async function fingerprintCredential(apiKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
