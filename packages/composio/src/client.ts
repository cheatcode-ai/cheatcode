import { readBoundedResponseJson, readBoundedResponseText } from "@cheatcode/observability";
import {
  parseAuthConfigId,
  parseAuthConfigPage,
  parseConnectedAccountPage,
  parseConnectionLink,
  parseToolExecution,
  parseToolkits,
  parseToolPage,
} from "./schemas";
import type {
  ComposioAuthConfigPage,
  ComposioConnectedAccountPage,
  ComposioConnectionLink,
  ComposioToolExecution,
  ComposioToolkit,
  ComposioToolPage,
  ExecuteToolInput,
  ListAuthConfigsInput,
  ListConnectedAccountsInput,
  ListToolkitsInput,
  ListToolsInput,
} from "./types";

const COMPOSIO_BASE_URL = "https://backend.composio.dev";
const CONTROL_RESPONSE_MAX_BYTES = 512 * 1024;
const ACCOUNT_RESPONSE_MAX_BYTES = 1024 * 1024;
const TOOLKIT_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const TOOL_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const EXECUTION_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const ERROR_RESPONSE_MAX_BYTES = 64 * 1024;
const REQUEST_BODY_MAX_BYTES = 256 * 1024;

type QueryValue = boolean | number | readonly string[] | string | undefined;

export class ComposioApiError extends Error {
  readonly status: number;

  constructor(status: number, message = `Composio request failed with status ${status}`) {
    super(message);
    this.name = "ComposioApiError";
    this.status = status;
  }
}

export function isComposioNotFoundError(error: unknown): boolean {
  return error instanceof ComposioApiError && error.status === 404;
}

export class ComposioClient {
  readonly #apiKey: string;

  constructor(apiKey: string) {
    const normalized = apiKey.trim();
    if (!normalized || normalized.length > 2_000) {
      throw new TypeError("A valid Composio API key is required");
    }
    this.#apiKey = normalized;
  }

  async listConnectedAccounts(
    input: ListConnectedAccountsInput,
    timeoutMs: number,
  ): Promise<ComposioConnectedAccountPage> {
    const response = await this.#requestJson("/api/v3.1/connected_accounts", {
      maxResponseBytes: ACCOUNT_RESPONSE_MAX_BYTES,
      query: {
        account_type: input.accountType,
        auth_config_ids: input.authConfigIds,
        cursor: input.cursor,
        limit: input.limit,
        statuses: input.statuses,
        toolkit_slugs: input.toolkitSlugs,
        user_ids: input.userIds,
      },
      timeoutMs,
    });
    return parseComposioResponse(() => parseConnectedAccountPage(response));
  }

  async listAuthConfigs(
    input: ListAuthConfigsInput,
    timeoutMs: number,
  ): Promise<ComposioAuthConfigPage> {
    const response = await this.#requestJson("/api/v3.1/auth_configs", {
      maxResponseBytes: CONTROL_RESPONSE_MAX_BYTES,
      query: {
        cursor: input.cursor,
        is_composio_managed: input.isComposioManaged,
        limit: input.limit,
        toolkit_slug: input.toolkit,
      },
      timeoutMs,
    });
    return parseComposioResponse(() => parseAuthConfigPage(response));
  }

  async createManagedAuthConfig(toolkit: string, name: string, timeoutMs: number): Promise<string> {
    const response = await this.#requestJson("/api/v3.1/auth_configs", {
      body: {
        auth_config: { name, type: "use_composio_managed_auth" },
        toolkit: { slug: toolkit },
      },
      maxResponseBytes: CONTROL_RESPONSE_MAX_BYTES,
      method: "POST",
      timeoutMs,
    });
    return parseComposioResponse(() => parseAuthConfigId(response));
  }

  async createConnectionLink(
    input: { authConfigId: string; callbackUrl: string; userId: string },
    timeoutMs: number,
  ): Promise<ComposioConnectionLink> {
    const response = await this.#requestJson("/api/v3.1/connected_accounts/link", {
      body: {
        auth_config_id: input.authConfigId,
        callback_url: input.callbackUrl,
        user_id: input.userId,
      },
      maxResponseBytes: CONTROL_RESPONSE_MAX_BYTES,
      method: "POST",
      timeoutMs,
    });
    return parseComposioResponse(() => parseConnectionLink(response));
  }

  async deleteConnectedAccount(connectionId: string, timeoutMs: number): Promise<void> {
    const id = encodeURIComponent(requiredIdentifier(connectionId));
    await this.#requestWithoutResult(`/api/v3.1/connected_accounts/${id}`, {
      query: { revoke_on_delete: true },
      timeoutMs,
    });
  }

  async listToolkits(input: ListToolkitsInput, timeoutMs: number): Promise<ComposioToolkit[]> {
    const response = await this.#requestJson("/api/v3.1/toolkits", {
      maxResponseBytes: TOOLKIT_RESPONSE_MAX_BYTES,
      query: {
        limit: input.limit,
        managed_by: input.managedBy,
        sort_by: input.sortBy,
      },
      timeoutMs,
    });
    return parseComposioResponse(() => parseToolkits(response));
  }

  async listTools(input: ListToolsInput, timeoutMs: number): Promise<ComposioToolPage> {
    const response = await this.#requestJson("/api/v3.1/tools", {
      maxResponseBytes: TOOL_RESPONSE_MAX_BYTES,
      query: {
        cursor: input.cursor,
        important: input.important === undefined ? undefined : String(input.important),
        limit: input.limit,
        query: input.search,
        toolkit_slug: input.toolkit,
        toolkit_versions: input.toolkitVersion ?? "latest",
      },
      timeoutMs,
    });
    return parseComposioResponse(() => parseToolPage(response));
  }

  async executeTool(
    slug: string,
    input: ExecuteToolInput,
    timeoutMs: number,
  ): Promise<ComposioToolExecution> {
    const toolSlug = encodeURIComponent(requiredIdentifier(slug, 200));
    const response = await this.#requestJson(`/api/v3.1/tools/execute/${toolSlug}`, {
      body: {
        arguments: input.arguments,
        connected_account_id: input.connectedAccountId,
        user_id: input.userId,
        version: input.version,
      },
      maxResponseBytes: EXECUTION_RESPONSE_MAX_BYTES,
      method: "POST",
      timeoutMs,
    });
    return parseComposioResponse(() => parseToolExecution(response));
  }

  async #requestJson(
    path: string,
    options: {
      body?: Record<string, unknown>;
      maxResponseBytes: number;
      method?: "GET" | "POST";
      query?: Record<string, QueryValue>;
      timeoutMs: number;
    },
  ): Promise<unknown> {
    const response = await this.#fetch(path, options);
    await assertSuccessfulResponse(response);
    return readBoundedResponseJson(response, options.maxResponseBytes, "Composio");
  }

  async #requestWithoutResult(
    path: string,
    options: { query?: Record<string, QueryValue>; timeoutMs: number },
  ): Promise<void> {
    const response = await this.#fetch(path, { ...options, method: "DELETE" });
    await assertSuccessfulResponse(response);
    await response.body?.cancel().catch(() => undefined);
  }

  async #fetch(
    path: string,
    options: {
      body?: Record<string, unknown>;
      method?: "DELETE" | "GET" | "POST";
      query?: Record<string, QueryValue>;
      timeoutMs: number;
    },
  ): Promise<Response> {
    const url = composioUrl(path, options.query);
    const body = options.body ? boundedRequestBody(options.body) : undefined;
    return fetch(url, {
      ...(body ? { body } : {}),
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        "x-api-key": this.#apiKey,
      },
      method: options.method ?? "GET",
      // Workers rejects `redirect: "error"`; manual mode keeps credentials
      // pinned to the configured Composio origin and treats 3xx as failures.
      redirect: "manual",
      signal: AbortSignal.timeout(validTimeout(options.timeoutMs)),
    });
  }
}

async function assertSuccessfulResponse(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  await readBoundedResponseText(response, ERROR_RESPONSE_MAX_BYTES, "Composio error").catch(
    () => undefined,
  );
  throw new ComposioApiError(response.status);
}

function parseComposioResponse<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new ComposioApiError(502, "Composio returned an invalid response");
  }
}

function boundedRequestBody(value: Record<string, unknown>): string {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > REQUEST_BODY_MAX_BYTES) {
    throw new RangeError("Composio request body exceeds the transport limit");
  }
  return body;
}

function composioUrl(path: string, query: Record<string, QueryValue> | undefined): URL {
  const url = new URL(path, COMPOSIO_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) {
      continue;
    }
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return url;
}

function requiredIdentifier(value: string, maxLength = 500): string {
  if (!value || value.length > maxLength) {
    throw new TypeError("Composio identifier is invalid");
  }
  return value;
}

function validTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 5 * 60 * 1000) {
    throw new RangeError("Composio timeout is invalid");
  }
  return value;
}
