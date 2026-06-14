import { z } from "zod";

/**
 * Daytona REST client — pure `fetch`, no SDK (Workers-safe; avoids the SDK's
 * @aws-sdk/@opentelemetry transitive deps, which our observability rules forbid).
 *
 * Two planes (both `Authorization: Bearer <apiKey>`):
 *  - control plane: `${apiUrl}/sandbox...`         (CRUD, lifecycle, preview)
 *  - toolbox plane: `${toolboxUrl}/{id}/...`        (process, sessions, fs)
 *
 * Endpoints/shapes verified live against the Tier-2 account (see
 * docs/plans/daytona-rest-reference.md §WS0).
 */

export const DEFAULT_DAYTONA_TOOLBOX_URL = "https://proxy.app.daytona.io/toolbox";

export interface DaytonaClientConfig {
  apiKey: string;
  apiUrl: string;
  target: string;
  organizationId?: string;
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
// Response schemas (passthrough — Daytona adds fields over time)
// ---------------------------------------------------------------------------

export const SandboxStateSchema = z.enum([
  "creating",
  "restoring",
  "destroyed",
  "destroying",
  "started",
  "stopped",
  "starting",
  "stopping",
  "error",
  "build_failed",
  "pending_build",
  "building_snapshot",
  "unknown",
  "pulling_snapshot",
  "archived",
  "archiving",
  "resizing",
]);

export const SandboxSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    organizationId: z.string().optional(),
    target: z.string().optional(),
    state: SandboxStateSchema.or(z.string()),
    desiredState: z.string().optional(),
    snapshot: z.string().nullable().optional(),
    user: z.string().optional(),
    cpu: z.number().optional(),
    memory: z.number().optional(),
    disk: z.number().optional(),
    public: z.boolean().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    autoStopInterval: z.number().optional(),
    autoArchiveInterval: z.number().optional(),
    autoDeleteInterval: z.number().optional(),
    backupState: z.string().optional(),
    runnerId: z.string().nullable().optional(),
    toolboxProxyUrl: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    lastActivityAt: z.string().optional(),
  })
  .passthrough();

export type DaytonaSandbox = z.infer<typeof SandboxSchema>;

const SandboxListSchema = z
  .object({ items: z.array(SandboxSchema).default([]) })
  .passthrough()
  .or(z.array(SandboxSchema).transform((items) => ({ items })));

export const ExecuteResponseSchema = z
  .object({
    exitCode: z.number().int(),
    result: z.string().nullable().optional(),
  })
  .passthrough();

export type DaytonaExecuteResponse = z.infer<typeof ExecuteResponseSchema>;

export const SessionExecResponseSchema = z
  .object({
    cmdId: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
    stdout: z.string().nullable().optional(),
    stderr: z.string().nullable().optional(),
    output: z.string().nullable().optional(),
  })
  .passthrough();

export type DaytonaSessionExecResponse = z.infer<typeof SessionExecResponseSchema>;

export const SessionCommandSchema = z
  .object({
    id: z.string(),
    command: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
  })
  .passthrough();

export const SessionSchema = z
  .object({
    sessionId: z.string(),
    commands: z.array(SessionCommandSchema).default([]),
  })
  .passthrough();

export type DaytonaSession = z.infer<typeof SessionSchema>;

export const FileInfoSchema = z
  .object({
    name: z.string(),
    size: z.number().int().nonnegative().default(0),
    isDir: z.boolean().default(false),
    modTime: z.string().optional(),
    modifiedAt: z.string().optional(),
    mode: z.string().optional(),
    permissions: z.string().optional(),
    owner: z.string().optional(),
    group: z.string().optional(),
  })
  .passthrough();

export type DaytonaFileInfo = z.infer<typeof FileInfoSchema>;

export const PreviewLinkSchema = z
  .object({
    sandboxId: z.string().optional(),
    url: z.string().url(),
    token: z.string(),
    legacyProxyUrl: z.string().optional(),
  })
  .passthrough();

export type DaytonaPreviewLink = z.infer<typeof PreviewLinkSchema>;

const FindMatchSchema = z
  .object({
    file: z.string(),
    line: z.number().int().optional(),
    content: z.string().optional(),
  })
  .passthrough();

const SearchFilesSchema = z.object({ files: z.array(z.string()).default([]) }).passthrough();

// ---------------------------------------------------------------------------
// Create params
// ---------------------------------------------------------------------------

export interface CreateSandboxParams {
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
}

export interface ExecuteParams {
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
  private readonly fetchImpl: typeof fetch;

  constructor(config: DaytonaClientConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = stripTrailingSlash(config.apiUrl);
    this.toolboxUrl = stripTrailingSlash(config.toolboxUrl ?? DEFAULT_DAYTONA_TOOLBOX_URL);
    this.target = config.target;
    this.organizationId = config.organizationId;
    this.fetchImpl = config.fetchImpl ?? fetch;
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
    const query = `?labels=${encodeURIComponent(JSON.stringify(labels))}`;
    const json = await this.control("GET", `/sandbox${query}`);
    return SandboxListSchema.parse(json).items;
  }

  async deleteSandbox(idOrName: string): Promise<void> {
    await this.control("DELETE", `/sandbox/${encodeURIComponent(idOrName)}`, { allow404: true });
  }

  async startSandbox(idOrName: string): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(idOrName)}/start`);
  }

  async stopSandbox(idOrName: string): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(idOrName)}/stop`);
  }

  async archiveSandbox(idOrName: string): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(idOrName)}/archive`);
  }

  /** minutes; 0 disables auto-stop (use during active runs). */
  async setAutoStopInterval(id: string, minutes: number): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(id)}/autostop/${minutes}`);
  }

  /** minutes; 0 = max (30d). */
  async setAutoArchiveInterval(id: string, minutes: number): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(id)}/autoarchive/${minutes}`);
  }

  /** minutes; -1 disables auto-delete (the durable-store guarantee). */
  async setAutoDeleteInterval(id: string, minutes: number): Promise<void> {
    await this.control("POST", `/sandbox/${encodeURIComponent(id)}/autodelete/${minutes}`);
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
    return PreviewLinkSchema.parse(json);
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
    return PreviewLinkSchema.parse(json);
  }

  // ----- toolbox plane: process -----

  async execute(id: string, params: ExecuteParams): Promise<DaytonaExecuteResponse> {
    const body: Record<string, unknown> = { command: params.command };
    if (params.cwd !== undefined) body["cwd"] = params.cwd;
    if (params.env !== undefined) body["env"] = params.env;
    if (params.timeout !== undefined) body["timeout"] = params.timeout;
    const json = await this.toolbox("POST", id, "/process/execute", { body });
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

  async getSession(id: string, sessionId: string): Promise<DaytonaSession | null> {
    const json = await this.toolbox(
      "GET",
      id,
      `/process/session/${encodeURIComponent(sessionId)}`,
      { allow404: true },
    );
    return json === null ? null : SessionSchema.parse(json);
  }

  async listSessions(id: string): Promise<DaytonaSession[]> {
    const json = await this.toolbox("GET", id, "/process/session");
    return z.array(SessionSchema).parse(json ?? []);
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
    return z.array(FileInfoSchema).parse(json ?? []);
  }

  async downloadFile(id: string, path: string): Promise<Uint8Array> {
    const res = await this.rawToolbox(
      "GET",
      id,
      `/files/download?path=${encodeURIComponent(path)}`,
    );
    return new Uint8Array(await res.arrayBuffer());
  }

  async uploadFile(id: string, path: string, bytes: Uint8Array): Promise<void> {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart]), basename(path));
    await this.rawToolbox("POST", id, `/files/upload?path=${encodeURIComponent(path)}`, {
      body: form,
    });
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

  /** Recursive name glob → absolute paths. */
  async searchFiles(id: string, path: string, pattern: string): Promise<string[]> {
    const json = await this.toolbox(
      "GET",
      id,
      `/files/search?path=${encodeURIComponent(path)}&pattern=${encodeURIComponent(pattern)}`,
    );
    return SearchFilesSchema.parse(json).files;
  }

  /** Recursive content grep → {file,line,content} (no column/options). */
  async findInFiles(
    id: string,
    path: string,
    pattern: string,
  ): Promise<Array<{ file: string; line?: number | undefined; content?: string | undefined }>> {
    const json = await this.toolbox(
      "GET",
      id,
      `/files/find?path=${encodeURIComponent(path)}&pattern=${encodeURIComponent(pattern)}`,
    );
    return z.array(FindMatchSchema).parse(json ?? []);
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
    options?: { body?: unknown; allow404?: boolean },
  ): Promise<unknown> {
    return this.request(method, `${this.apiUrl}${path}`, options);
  }

  private async toolbox(
    method: string,
    id: string,
    path: string,
    options?: { body?: unknown; allow404?: boolean; allowConflict?: boolean },
  ): Promise<unknown> {
    return this.request(method, `${this.toolboxUrl}/${encodeURIComponent(id)}${path}`, options);
  }

  private async toolboxText(id: string, path: string): Promise<string> {
    const res = await this.rawToolbox("GET", id, path);
    return res.text();
  }

  private async rawToolbox(
    method: string,
    id: string,
    path: string,
    options?: { body?: BodyInit },
  ): Promise<Response> {
    const url = `${this.toolboxUrl}/${encodeURIComponent(id)}${path}`;
    const init: RequestInit = { method, headers: this.headers() };
    if (options?.body !== undefined) {
      init.body = options.body;
    }
    const res = await this.fetchImpl(url, init);
    if (!res.ok) {
      throw await toApiError(res);
    }
    return res;
  }

  private async request(
    method: string,
    url: string,
    options?: { body?: unknown; allow404?: boolean; allowConflict?: boolean },
  ): Promise<unknown> {
    const init: RequestInit = { method, headers: this.headers() };
    if (options?.body !== undefined) {
      init.headers = this.headers({ "Content-Type": "application/json" });
      init.body = JSON.stringify(options.body);
    }
    const res = await this.fetchImpl(url, init);
    if (res.status === 404 && options?.allow404) {
      return null;
    }
    if (res.status === 409 && options?.allowConflict) {
      return null;
    }
    if (!res.ok) {
      throw await toApiError(res);
    }
    if (res.status === 204) {
      return null;
    }
    const text = await res.text();
    if (text.length === 0) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

async function toApiError(res: Response): Promise<DaytonaApiError> {
  let details: unknown;
  let message = `Daytona request failed (HTTP ${res.status})`;
  try {
    const text = await res.text();
    if (text.length > 0) {
      try {
        const parsed: unknown = JSON.parse(text);
        details = parsed;
        if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
          const candidate = (parsed as { message?: unknown }).message;
          if (typeof candidate === "string") {
            message = candidate;
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
