import { createServer } from "node:http";
import { Stagehand } from "@browserbasehq/stagehand";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
const DISPLAY = ":99";
const PORT = Number(process.env.CHEATCODE_BROWSER_DRIVER_PORT || "9323");
const MAX_BODY_BYTES = 500_000;
const MODEL_NAME = process.env.STAGEHAND_MODEL || DEFAULT_MODEL;
const CREDENTIAL_FINGERPRINT =
  process.env.CHEATCODE_BROWSER_DRIVER_CREDENTIAL_FINGERPRINT || "unknown";

let stagehandPromise;

function modelConfig() {
  const apiKey =
    process.env.STAGEHAND_MODEL_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.ANTHROPIC_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";

  if (!apiKey) {
    return MODEL_NAME;
  }

  if (MODEL_NAME.startsWith("anthropic/")) {
    process.env.ANTHROPIC_API_KEY ||= apiKey;
  }
  if (MODEL_NAME.startsWith("openai/")) {
    process.env.OPENAI_API_KEY ||= apiKey;
  }
  if (MODEL_NAME.startsWith("google/")) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= apiKey;
    process.env.GOOGLE_API_KEY ||= apiKey;
  }

  return MODEL_NAME;
}

function createStagehand() {
  return new Stagehand({
    env: "LOCAL",
    model: modelConfig(),
    localBrowserLaunchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      chromiumSandbox: false,
      connectTimeoutMs: 30000,
      env: { ...process.env, DISPLAY },
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
  await stagehand.init();
  return stagehand;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Browser action payload is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runActions(stagehand, actions) {
  const results = [];
  const page = stagehand.context.pages()[0] || (await stagehand.context.newPage());

  for (const action of actions) {
    switch (action.type) {
      case "goto": {
        await page.goto(action.url, { waitUntil: action.waitUntil || "domcontentloaded" });
        results.push({ type: action.type, url: page.url() });
        break;
      }
      case "act": {
        const result = await stagehand.act(action.instruction, {
          timeout: action.timeoutMs || 10000,
        });
        results.push({ result, type: action.type, url: page.url() });
        break;
      }
      case "observe": {
        const result = await stagehand.observe(action.instruction);
        results.push({ result, type: action.type, url: page.url() });
        break;
      }
      case "extract": {
        const result =
          typeof action.instruction === "string"
            ? await stagehand.extract(action.instruction)
            : await stagehand.extract();
        results.push({ result, type: action.type, url: page.url() });
        break;
      }
      case "screenshot": {
        const buffer = await page.screenshot({
          fullPage: Boolean(action.fullPage),
          type: "png",
        });
        results.push({
          base64: buffer.toString("base64"),
          mediaType: "image/png",
          type: action.type,
          url: page.url(),
        });
        break;
      }
      default:
        throw new Error(`Unsupported browser action type: ${action.type}`);
    }
  }

  return results;
}

function jsonResponse(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-length": String(Buffer.byteLength(body)),
    "content-type": "application/json",
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      await stagehandInstance();
      jsonResponse(response, 200, {
        credentialFingerprint: CREDENTIAL_FINGERPRINT,
        model: MODEL_NAME,
        ok: true,
      });
      return;
    }

    if (request.method === "POST" && request.url === "/actions") {
      const rawBody = await readBody(request);
      const input = rawBody.trim() ? JSON.parse(rawBody) : { actions: [] };
      const stagehand = await stagehandInstance();
      const results = await runActions(stagehand, input.actions || []);
      jsonResponse(response, 200, { ok: true, results });
      return;
    }

    jsonResponse(response, 404, { error: "not_found", ok: false });
  } catch (error) {
    jsonResponse(response, 500, {
      error: error instanceof Error ? error.message : "Unknown browser driver error",
      ok: false,
    });
  }
});

server.listen(PORT, "127.0.0.1");

process.on("SIGTERM", async () => {
  server.close();
  if (stagehandPromise) {
    const stagehand = await stagehandPromise.catch(() => null);
    await stagehand?.close().catch(() => undefined);
  }
  process.exit(0);
});
