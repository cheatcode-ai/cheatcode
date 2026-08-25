import {
  createOutputDownloadCapability,
  OutputDownloadQuerySchema,
  verifySignedOutputDownload,
} from "@cheatcode/auth";
import { findGeneratedOutput, withUserDb } from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import { OutputIdSchema, toUserId, type UserId } from "@cheatcode/types";
import { AGENT_FORWARD_ROUTES } from "@cheatcode/types/internal";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { ArtifactEnv } from "./artifact-env";

type ArtifactContext = Context<{ Bindings: ArtifactEnv }>;

export function registerOutputRoutes(app: Hono<{ Bindings: ArtifactEnv }>): void {
  const routes = AGENT_FORWARD_ROUTES.core;
  app.on(
    routes.mintOutputDownloadUrl.method,
    routes.mintOutputDownloadUrl.path,
    mintOutputDownloadUrl,
  );
  app.on(routes.downloadOutput.method, routes.downloadOutput.path, downloadOutput);
}

async function mintOutputDownloadUrl(c: ArtifactContext): Promise<Response> {
  const outputId = parseOutputId(c.req.param("outputId"));
  const userId = toUserId(readGatewayUserId(c.req.raw.headers));
  const output = await findDownloadableOutput(c.env, outputId, userId);
  if (!(await c.env.R2_OUTPUTS.head(output.r2Key))) {
    throw outputNotFound("Output object not found");
  }
  const capability = await createOutputDownloadCapability({
    baseUrl: c.env.OUTPUT_DOWNLOAD_BASE_URL,
    outputId,
    secret: await resolveOutputSigningSecret(c.env.OUTPUT_DOWNLOAD_SIGNING_SECRET),
    userId,
  });
  const response = c.json(capability);
  setPrivateDownloadHeaders(response.headers);
  return response;
}

async function downloadOutput(c: ArtifactContext): Promise<Response> {
  const outputId = parseOutputId(c.req.param("outputId"));
  const query = parseOutputDownloadQuery(c);
  if (!(await isAuthorizedDownload(c.env, outputId, query))) {
    throw new APIError(403, "permission_access_denied", "Invalid or expired output download URL", {
      retriable: false,
    });
  }
  const output = await findDownloadableOutput(c.env, outputId, query.userId);
  let object: R2Object | R2ObjectBody | null;
  try {
    object = await c.env.R2_OUTPUTS.get(output.r2Key, {
      onlyIf: c.req.raw.headers,
      range: c.req.raw.headers,
    });
  } catch (error) {
    if (!isInvalidRangeError(error)) {
      throw error;
    }
    const metadata = await c.env.R2_OUTPUTS.head(output.r2Key);
    if (!metadata) {
      throw outputNotFound("Output object not found");
    }
    return invalidRangeResponse(metadata, output.filename, output.mimeType);
  }
  if (!object) {
    throw outputNotFound("Output object not found");
  }
  const headers = outputHeaders(object, output.filename, output.mimeType);
  if (!("body" in object)) {
    headers.delete("Content-Length");
    headers.delete("Content-Range");
    return new Response(null, {
      headers,
      status: conditionalReadStatus(c.req.raw.headers),
    });
  }
  return new Response(object.body, {
    headers,
    status: object.range ? 206 : 200,
  });
}

function invalidRangeResponse(object: R2Object, filename: string, mimeType: string): Response {
  const headers = outputHeaders(object, filename, mimeType);
  headers.set("Content-Length", "0");
  headers.set("Content-Range", `bytes */${object.size}`);
  return new Response(null, { headers, status: 416 });
}

function isInvalidRangeError(error: unknown): boolean {
  return error instanceof Error && /\(10039\)$/u.test(error.message);
}

function conditionalReadStatus(headers: Headers): 304 | 412 {
  return headers.has("If-None-Match") || headers.has("If-Modified-Since") ? 304 : 412;
}

async function isAuthorizedDownload(
  env: ArtifactEnv,
  outputId: string,
  query: z.infer<typeof OutputDownloadQuerySchema>,
): Promise<boolean> {
  return verifySignedOutputDownload({
    expires: query.expires,
    outputId,
    secret: await resolveOutputSigningSecret(env.OUTPUT_DOWNLOAD_SIGNING_SECRET),
    signature: query.sig,
    userId: query.userId,
  });
}

function outputHeaders(object: R2Object, filename: string, mimeType: string): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  setPrivateDownloadHeaders(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Disposition", downloadContentDisposition(filename));
  headers.set("Content-Type", mimeType);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  const range = object.range ? normalizedRange(object.range, object.size) : undefined;
  if (range) {
    headers.set("Content-Length", String(range.length));
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
    );
  } else {
    headers.set("Content-Length", String(object.size));
  }
  return headers;
}

function normalizedRange(range: R2Range, size: number): { length: number; offset: number } {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size);
    return { length, offset: size - length };
  }
  const offset = range.offset ?? 0;
  return { length: Math.min(range.length ?? size - offset, size - offset), offset };
}

function setPrivateDownloadHeaders(headers: Headers): void {
  headers.set("Cache-Control", "private, max-age=0, no-store");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Referrer-Policy", "no-referrer");
}

function parseOutputId(value: string | undefined): string {
  const parsed = OutputIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "request_path_param_invalid", "Invalid output id", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

function parseOutputDownloadQuery(c: ArtifactContext): z.infer<typeof OutputDownloadQuerySchema> {
  const parsed = OutputDownloadQuerySchema.safeParse({
    expires: c.req.query("expires"),
    sig: c.req.query("sig"),
    userId: c.req.query("userId"),
  });
  if (!parsed.success) {
    throw new APIError(400, "request_query_param_invalid", "Invalid output download signature", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

async function findDownloadableOutput(env: ArtifactEnv, outputId: string, userId: UserId) {
  return withUserDb(env, userId, async ({ transaction }) => {
    const output = await transaction((tx) => findGeneratedOutput(tx, { outputId, userId }));
    if (!output) {
      throw outputNotFound("Output not found");
    }
    return output;
  });
}

function readGatewayUserId(headers: Headers): string {
  const parsed = z.string().uuid().safeParse(headers.get("X-Cheatcode-User-Id"));
  if (!parsed.success) {
    throw new APIError(401, "auth_token_missing", "Missing gateway user header", {
      hint: "Call artifact-worker through gateway-worker service binding.",
      retriable: false,
    });
  }
  return parsed.data;
}

async function resolveOutputSigningSecret(secret: WorkerSecret): Promise<string | undefined> {
  try {
    return await resolveWorkerSecret(secret);
  } catch {
    throw new APIError(
      503,
      "service_maintenance_unavailable",
      "Output signing secret is unavailable",
      { retriable: true },
    );
  }
}

function outputNotFound(message: string): APIError {
  return new APIError(404, "resource_output_not_found", message, { retriable: false });
}

function downloadContentDisposition(filename: string): string {
  const sanitized = Array.from(filename, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 ||
      codePoint === 127 ||
      character === "/" ||
      character === "\\" ||
      character === '"'
      ? "_"
      : character;
  })
    .slice(0, 200)
    .join("");
  const safeName = sanitized || "cheatcode-output";
  const asciiFallback = safeName.replaceAll(/[^\x20-\x7e]/gu, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
