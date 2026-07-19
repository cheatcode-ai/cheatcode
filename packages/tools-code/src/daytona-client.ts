import {
  type DaytonaPreviewLink,
  parseDaytonaPreviewHostSuffixes,
  parseDaytonaPreviewLink,
} from "@cheatcode/types/daytona-preview";
import { z } from "zod";

/**
 * Daytona REST client — pure `fetch`, no SDK (Workers-safe; avoids the SDK's
 * @aws-sdk/@opentelemetry transitive deps, which our observability rules forbid).
 *
 * Two planes (both `Authorization: Bearer <apiKey>`):
 *  - control plane: `${apiUrl}/sandbox...`         (CRUD, lifecycle, preview)
 *  - toolbox plane: `${toolboxUrl}/{id}/...`        (process, sessions, fs)
 *
 * Endpoint and response shapes were verified against the live Daytona account;
 * every response is validated locally before it reaches the sandbox runtime.
 */

const DEFAULT_DAYTONA_TOOLBOX_URL = "https://proxy.app.daytona.io/toolbox";
const DEFAULT_DAYTONA_REQUEST_TIMEOUT_MS = 60_000;
const DAYTONA_FILE_TRANSFER_TIMEOUT_MS = 120_000;
const DAYTONA_EXEC_OVERHEAD_MS = 15_000;
const DAYTONA_JSON_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const DAYTONA_ERROR_RESPONSE_MAX_BYTES = 64 * 1024;
const DAYTONA_BUFFERED_FILE_MAX_BYTES = 16 * 1024 * 1024;
const DAYTONA_LOG_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const DAYTONA_ID_MAX_CHARACTERS = 500;
const DAYTONA_PATH_MAX_CHARACTERS = 4_096;
const DAYTONA_COMMAND_MAX_CHARACTERS = 100_000;
const DAYTONA_CURSOR_MAX_CHARACTERS = 4_096;
const DAYTONA_TEXT_OUTPUT_MAX_CHARACTERS = 4 * 1024 * 1024;
const DAYTONA_FILE_LIST_MAX_ITEMS = 1_000;
const DAYTONA_SANDBOX_PAGE_MAX_ITEMS = 100;
const DAYTONA_SESSION_COMMAND_MAX_ITEMS = 1_000;
const DAYTONA_VOLUME_NAME_MAX_CHARACTERS = 100;

interface DaytonaClientConfig {
  apiKey: string;
  apiUrl: string;
  target: string;
  organizationId?: string;
  previewHostSuffixes?: string;
  requestTimeoutMs?: number;
  toolboxUrl?: string;
  fetchImpl?: typeof fetch;
}

export class DaytonaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retriable: boolean;
  readonly details: unknown;

  constructor(
    status: number,
    message: string,
    options?: { code?: string; retriable?: boolean; details?: unknown },
  ) {
    super(message);
    this.name = "DaytonaApiError";
    this.status = status;
    this.code = options?.code ?? "daytona_error";
    this.retriable = options?.retriable ?? (status >= 500 || status === 429);
    this.details = options?.details;
  }
}

// ---------------------------------------------------------------------------
// Response schemas project provider payloads down to fields used by the runtime.
// ---------------------------------------------------------------------------

const SandboxLabelsSchema = z
  .record(z.string().min(1).max(100), z.string().min(1).max(DAYTONA_ID_MAX_CHARACTERS))
  .refine((labels) => Object.keys(labels).length <= 50, "Sandbox labels exceed the safe limit.");

const SandboxVolumeSchema = z
  .object({
    mountPath: z.string().min(1).max(DAYTONA_PATH_MAX_CHARACTERS),
    subpath: z.string().min(1).max(DAYTONA_PATH_MAX_CHARACTERS).nullable().optional(),
    volumeId: z.string().min(1).max(DAYTONA_ID_MAX_CHARACTERS),
  })
  .strip();

const SandboxSchema = z
  .object({
    id: z.string().min(1).max(DAYTONA_ID_MAX_CHARACTERS),
    labels: SandboxLabelsSchema,
    name: z.string().min(1).max(DAYTONA_ID_MAX_CHARACTERS),
    snapshot: z.string().min(1).max(DAYTONA_ID_MAX_CHARACTERS),
    state: z.string().min(1).max(100),
    target: z.string().min(1).max(100),
    user: z.string().min(1).max(100),
    volumes: z.array(SandboxVolumeSchema).max(50).optional(),
    backupState: z.string().min(1).max(100).nullable().optional(),
    desiredState: z.string().min(1).max(100).nullable().optional(),
  })
  .strip();

export type DaytonaSandbox = z.infer<typeof SandboxSchema>;

const VolumeSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(DAYTONA_VOLUME_NAME_MAX_CHARACTERS),
    organizationId: z.string().min(1).max(DAYTONA_ID_MAX_CHARACTERS),
    state: z.string().min(1).max(100),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    errorReason: z.string().max(2_000).nullable().optional(),
    lastUsedAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strip();

export type DaytonaVolume = z.infer<typeof VolumeSchema>;

const SandboxListSchema = z
  .object({
    items: z.array(SandboxSchema).max(DAYTONA_SANDBOX_PAGE_MAX_ITEMS),
    nextCursor: z.string().min(1).max(DAYTONA_CURSOR_MAX_CHARACTERS).nullable(),
  })
  .strict();

const ExecuteResponseSchema = z
  .object({
    exitCode: z.number().int(),
    result: z.string().max(DAYTONA_TEXT_OUTPUT_MAX_CHARACTERS).nullable().optional(),
  })
  .strip();

type DaytonaExecuteResponse = z.infer<typeof ExecuteResponseSchema>;

const SessionExecResponseSchema = z
  .object({
    cmdId: z.string().max(DAYTONA_ID_MAX_CHARACTERS).optional(),
    exitCode: z.number().int().nullable().optional(),
    stdout: z.string().max(DAYTONA_TEXT_OUTPUT_MAX_CHARACTERS).nullable().optional(),
    stderr: z.string().max(DAYTONA_TEXT_OUTPUT_MAX_CHARACTERS).nullable().optional(),
    output: z.string().max(DAYTONA_TEXT_OUTPUT_MAX_CHARACTERS).nullable().optional(),
  })
  .strip();

export type DaytonaSessionExecResponse = z.infer<typeof SessionExecResponseSchema>;

const SessionCommandSchema = z
  .object({
    id: z.string().min(1).max(DAYTONA_ID_MAX_CHARACTERS),
    command: z.string().max(DAYTONA_COMMAND_MAX_CHARACTERS).optional(),
    exitCode: z.number().int().nullable().optional(),
  })
  .strip();

const SessionSchema = z
  .object({
    sessionId: z.string().min(1).max(DAYTONA_ID_MAX_CHARACTERS),
    commands: z.array(SessionCommandSchema).max(DAYTONA_SESSION_COMMAND_MAX_ITEMS).default([]),
  })
  .strip();

type DaytonaSession = z.infer<typeof SessionSchema>;

const FileInfoSchema = z
  .object({
    isDir: z.boolean(),
    modifiedAt: z.string().datetime({ offset: true }),
    name: z.string().min(1).max(DAYTONA_PATH_MAX_CHARACTERS),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strip();

export type DaytonaFileInfo = z.infer<typeof FileInfoSchema>;

export interface SandboxDestroyResult {
  deleted: boolean;
  sandboxId: string;
}

// ---------------------------------------------------------------------------
// Create params
// ---------------------------------------------------------------------------

interface CreateSandboxParams {
  name?: string;
  snapshot?: string;
  labels?: Record<string, string>;
  env?: Record<string, string>;
  target?: string;
  user?: string;
  public?: boolean;
  autoStopInterval?: number;
  autoArchiveInterval?: number;
  autoDeleteInterval?: number;
  volumes?: Array<{ mountPath: string; subpath?: string; volumeId: string }>;
}

interface ExecuteParams {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  /** seconds */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class DaytonaClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly toolboxUrl: string;
  private readonly target: string;
  private readonly organizationId: string | undefined;
  private readonly previewHostSuffixes: readonly string[];
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: DaytonaClientConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = stripTrailingSlash(config.apiUrl);
    this.toolboxUrl = stripTrailingSlash(config.toolboxUrl ?? DEFAULT_DAYTONA_TOOLBOX_URL);
    this.target = config.target;
    this.organizationId = config.organizationId;
    this.previewHostSuffixes = parseDaytonaPreviewHostSuffixes(config.previewHostSuffixes);
    this.requestTimeoutMs = positiveTimeout(config.requestTimeoutMs);
    // Bind to globalThis: the global `fetch` must keep the global scope as its
    // receiver. Calling it as a method (`this.fetchImpl(...)`) otherwise rebinds
    // `this` to the client instance, which workerd rejects with "Illegal
    // invocation: function called with incorrect 'this' reference."
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
  }

  // ----- control plane: sandbox lifecycle -----

  async createSandbox(params: CreateSandboxParams): Promise<DaytonaSandbox> {
    const body: Record<string, unknown> = { target: params.target ?? this.target };
    if (params.name !== undefined) body["name"] = params.name;
    if (params.snapshot !== undefined) body["snapshot"] = params.snapshot;
    if (params.user !== undefined) body["user"] = params.user;
    if (params.labels !== undefined) body["labels"] = params.labels;
    if (params.env !== undefined) body["env"] = params.env;
    if (params.public !== undefined) body["public"] = params.public;
    if (params.autoStopInterval !== undefined) body["autoStopInterval"] = params.autoStopInterval;
    if (params.autoArchiveInterval !== undefined) {
      body["autoArchiveInterval"] = params.autoArchiveInterval;
    }
    if (params.autoDeleteInterval !== undefined) {
      body["autoDeleteInterval"] = params.autoDeleteInterval;
    }
    if (params.volumes !== undefined) body["volumes"] = params.volumes;
    const json = await this.control("POST", "/sandbox", { body });
    return SandboxSchema.parse(json);
  }

  /** Returns null on 404 (used by the DO's get-or-create). */
  async getSandbox(idOrName: string): Promise<DaytonaSandbox | null> {
    const json = await this.control("GET", `/sandbox/${encodeURIComponent(idOrName)}`, {
      allow404: true,
    });
    return json === null ? null : SandboxSchema.parse(json);
  }

  /** Authoritative lookup when the cached id is missing — names are not unique. */
  async listSandboxesByLabels(labels: Record<string, string>): Promise<DaytonaSandbox[]> {
    const sandboxes: DaytonaSandbox[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    while (true) {
      const query = new URLSearchParams({
        labels: JSON.stringify(labels),
        limit: String(DAYTONA_SANDBOX_PAGE_MAX_ITEMS),
      });
      if (cursor) {
        query.set("cursor", cursor);
      }
      const json = await this.control("GET", `/sandbox?${query.toString()}`);
      const page = SandboxListSchema.parse(json);
      sandboxes.push(...page.items);
      if (!page.nextCursor) {
        return sandboxes;
      }
      if (seenCursors.has(page.nextCursor)) {
        throw new DaytonaApiError(502, "Daytona sandbox pagination repeated a cursor", {
          code: "daytona_invalid_response",
          retriable: true,
        });
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  async deleteSandbox(idOrName: string): Promise<void> {
    await this.control("DELETE", `/sandbox/${encodeURIComponent(idOrName)}`, { allow404: true });
  }

  /** Replaces the complete label set; omitted labels are removed by Daytona. */
  async replaceSandboxLabels(idOrName: string, labels: Record<string, string>): Promise<void> {
    await this.control("PUT", `/sandbox/${encodeURIComponent(idOrName)}/labels`, {
      body: { labels: SandboxLabelsSchema.parse(labels) },
    });
  }

  async createVolume(name: string): Promise<DaytonaVolume> {
    const json = await this.control("POST", "/volumes", {
      body: { name: volumeName(name) },
    });
    return VolumeSchema.parse(json);
  }

  async getVolumeByName(name: string): Promise<DaytonaVolume | null> {
    const json = await this.control(
      "GET",
      `/volumes/by-name/${encodeURIComponent(volumeName(name))}`,
      { allow404: true },
    );
    return json === null ? null : VolumeSchema.parse(json);
  }

  async startSandbox(idOrName: string): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(idOrName)}/start`);
  }

  async stopSandbox(idOrName: string): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(idOrName)}/stop`);
  }

  /** minutes; 0 disables auto-stop (use during active runs). */
  async setAutoStopInterval(id: string, minutes: number): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(id)}/autostop/${minutes}`);
  }

  /** Keepalive — bumps lastActivityAt without a state change (id only). */
  async refreshActivity(id: string): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(id)}/last-activity`, {
      allow404: true,
    });
  }

  async getPreviewLink(id: string, port: number): Promise<DaytonaPreviewLink> {
    const json = await this.control(
      "GET",
      `/sandbox/${encodeURIComponent(id)}/ports/${port}/preview-url`,
    );
    return parseDaytonaPreviewLink(json, this.previewHostSuffixes);
  }

  async getSignedPreviewUrl(
    id: string,
    port: number,
    expiresInSeconds: number,
  ): Promise<DaytonaPreviewLink> {
    const json = await this.control(
      "GET",
      `/sandbox/${encodeURIComponent(id)}/ports/${port}/signed-preview-url?expiresInSeconds=${expiresInSeconds}`,
    );
    return parseDaytonaPreviewLink(json, this.previewHostSuffixes);
  }

  // ----- toolbox plane: process -----

  async execute(id: string, params: ExecuteParams): Promise<DaytonaExecuteResponse> {
    const body: Record<string, unknown> = { command: params.command };
    if (params.cwd !== undefined) body["cwd"] = params.cwd;
    if (params.env !== undefined) body["env"] = params.env;
    if (params.timeout !== undefined) body["timeout"] = params.timeout;
    const json = await this.toolbox("POST", id, "/process/execute", {
      body,
      timeoutMs: (params.timeout ?? 600) * 1_000 + DAYTONA_EXEC_OVERHEAD_MS,
    });
    return ExecuteResponseSchema.parse(json);
  }

  async createSession(id: string, sessionId: string): Promise<void> {
    await this.toolbox("POST", id, "/process/session", {
      body: { sessionId },
      allowConflict: true,
    });
  }

  async execSessionCommand(
    id: string,
    sessionId: string,
    command: string,
    runAsync: boolean,
  ): Promise<DaytonaSessionExecResponse> {
    const json = await this.toolbox(
      "POST",
      id,
      `/process/session/${encodeURIComponent(sessionId)}/exec`,
      { body: { command, runAsync } },
    );
    return SessionExecResponseSchema.parse(json);
  }

  async sendSessionCommandInput(
    id: string,
    sessionId: string,
    commandId: string,
    data: string,
  ): Promise<void> {
    await this.toolbox(
      "POST",
      id,
      `/process/session/${encodeURIComponent(sessionId)}/command/${encodeURIComponent(commandId)}/input`,
      { body: { data } },
    );
  }

  async getSession(id: string, sessionId: string): Promise<DaytonaSession | null> {
    const json = await this.toolbox(
      "GET",
      id,
      `/process/session/${encodeURIComponent(sessionId)}`,
      { allow404: true },
    );
    return json === null ? null : SessionSchema.parse(json);
  }

  /** Snapshot of the full accumulated log buffer (no cursor — caller diffs). */
  async getSessionCommandLogs(id: string, sessionId: string, cmdId: string): Promise<string> {
    return this.toolboxText(
      id,
      `/process/session/${encodeURIComponent(sessionId)}/command/${encodeURIComponent(cmdId)}/logs`,
    );
  }

  /** Kills the whole session (its shell + every command). */
  async deleteSession(id: string, sessionId: string): Promise<void> {
    await this.toolbox("DELETE", id, `/process/session/${encodeURIComponent(sessionId)}`, {
      allow404: true,
    });
  }

  // ----- toolbox plane: filesystem -----

  async listFiles(id: string, path: string): Promise<DaytonaFileInfo[]> {
    const json = await this.toolbox("GET", id, `/files?path=${encodeURIComponent(path)}`);
    return z
      .array(FileInfoSchema)
      .max(DAYTONA_FILE_LIST_MAX_ITEMS)
      .parse(json ?? []);
  }

  async downloadFile(
    id: string,
    path: string,
    maxBytes = DAYTONA_BUFFERED_FILE_MAX_BYTES,
  ): Promise<Uint8Array> {
    const res = await this.downloadFileResponse(id, path);
    return readBoundedResponseBytes(res, maxBytes);
  }

  /** Keeps large file downloads streaming instead of buffering them in the Worker isolate. */
  async downloadFileResponse(id: string, path: string): Promise<Response> {
    return this.rawToolbox("GET", id, `/files/download?path=${encodeURIComponent(path)}`, {
      timeoutMs: DAYTONA_FILE_TRANSFER_TIMEOUT_MS,
    });
  }

  async uploadFile(id: string, path: string, bytes: Uint8Array): Promise<void> {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart]), basename(path));
    const response = await this.rawToolbox(
      "POST",
      id,
      `/files/upload?path=${encodeURIComponent(path)}`,
      {
        body: form,
        timeoutMs: DAYTONA_FILE_TRANSFER_TIMEOUT_MS,
      },
    );
    await response.body?.cancel().catch(() => undefined);
  }

  async createFolder(id: string, path: string, mode = "0755"): Promise<void> {
    await this.toolbox(
      "POST",
      id,
      `/files/folder?path=${encodeURIComponent(path)}&mode=${encodeURIComponent(mode)}`,
      { allowConflict: true },
    );
  }

  async deleteFilePath(id: string, path: string, recursive: boolean): Promise<void> {
    await this.toolbox(
      "DELETE",
      id,
      `/files?path=${encodeURIComponent(path)}&recursive=${recursive}`,
      { allow404: true },
    );
  }

  // ----- transport helpers -----

  private headers(extra?: Record<string, string>): Headers {
    const headers = new Headers({ Authorization: `Bearer ${this.apiKey}`, ...extra });
    if (this.organizationId) {
      headers.set("X-Daytona-Organization-ID", this.organizationId);
    }
    return headers;
  }

  private async control(
    method: string,
    path: string,
    options?: { body?: unknown; allow404?: boolean; timeoutMs?: number },
  ): Promise<unknown> {
    return this.request(method, `${this.apiUrl}${path}`, options);
  }

  private async toolbox(
    method: string,
    id: string,
    path: string,
    options?: { body?: unknown; allow404?: boolean; allowConflict?: boolean; timeoutMs?: number },
  ): Promise<unknown> {
    return this.request(method, `${this.toolboxUrl}/${encodeURIComponent(id)}${path}`, options);
  }

  private async toolboxText(id: string, path: string): Promise<string> {
    const res = await this.rawToolbox("GET", id, path);
    return readBoundedResponseText(res, DAYTONA_LOG_RESPONSE_MAX_BYTES);
  }

  private async rawToolbox(
    method: string,
    id: string,
    path: string,
    options?: { body?: BodyInit; timeoutMs?: number },
  ): Promise<Response> {
    const url = `${this.toolboxUrl}/${encodeURIComponent(id)}${path}`;
    const init: RequestInit = { method, headers: this.headers() };
    if (options?.body !== undefined) {
      init.body = options.body;
    }
    const res = await this.fetchWithDeadline(url, init, options?.timeoutMs);
    if (!res.ok) {
      throw await toApiError(res);
    }
    return res;
  }

  private async request(
    method: string,
    url: string,
    options?: { body?: unknown; allow404?: boolean; allowConflict?: boolean; timeoutMs?: number },
  ): Promise<unknown> {
    const init: RequestInit = { method, headers: this.headers() };
    if (options?.body !== undefined) {
      init.headers = this.headers({ "Content-Type": "application/json" });
      init.body = JSON.stringify(options.body);
    }
    const res = await this.fetchWithDeadline(url, init, options?.timeoutMs);
    if (res.status === 404 && options?.allow404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if (res.status === 409 && options?.allowConflict) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!res.ok) {
      throw await toApiError(res);
    }
    if (res.status === 204) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = await readBoundedResponseText(res, DAYTONA_JSON_RESPONSE_MAX_BYTES).catch(
      (error: unknown) => {
        if (error instanceof DaytonaApiError) {
          throw error;
        }
        throw responseTooLargeError(DAYTONA_JSON_RESPONSE_MAX_BYTES);
      },
    );
    if (text.length === 0) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async fetchWithDeadline(
    url: string,
    init: RequestInit,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal });
    } catch (error) {
      if (signal.aborted) {
        throw new DaytonaApiError(504, "Daytona request timed out", {
          code: "daytona_timeout",
          details: { method: init.method ?? "GET", timeoutMs },
          retriable: true,
        });
      }
      throw error;
    }
  }
}

async function toApiError(res: Response): Promise<DaytonaApiError> {
  let details: unknown;
  let message = `Daytona request failed (HTTP ${res.status})`;
  try {
    const text = await readBoundedResponseText(res, DAYTONA_ERROR_RESPONSE_MAX_BYTES);
    if (text.length > 0) {
      try {
        const parsed: unknown = JSON.parse(text);
        details = parsed;
        if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
          const candidate = (parsed as { message?: unknown }).message;
          if (typeof candidate === "string") {
            message = candidate.slice(0, 1_000);
          }
        }
      } catch {
        details = text.slice(0, 500);
      }
    }
  } catch {
    // ignore body read failures
  }
  return new DaytonaApiError(res.status, message, { details });
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1) || "file";
}

function volumeName(value: string): string {
  return z.string().min(1).max(DAYTONA_VOLUME_NAME_MAX_CHARACTERS).parse(value);
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedResponseBytes(response, maxBytes));
}

async function readBoundedResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Response byte limit must be a positive safe integer");
  }
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw responseTooLargeError(maxBytes);
  }
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw responseTooLargeError(maxBytes);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function responseTooLargeError(maxBytes: number): DaytonaApiError {
  return new DaytonaApiError(502, "Daytona response exceeded the Worker byte limit", {
    code: "daytona_response_too_large",
    details: { maxBytes },
    retriable: false,
  });
}

function positiveTimeout(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_DAYTONA_REQUEST_TIMEOUT_MS;
}
