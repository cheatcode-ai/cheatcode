import type { ClientRequestOptions } from "hono/client";

export type GatewayClientFetch = NonNullable<ClientRequestOptions["fetch"]>;
export type GatewayClientHeaders = NonNullable<ClientRequestOptions["headers"]>;

export interface GatewayClientOptions {
  fetch?: GatewayClientFetch;
  headers?: GatewayClientHeaders;
  init?: RequestInit;
}

export function normalizeGatewayBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error("Gateway base URL is required.");
  }
  const url = new URL(trimmed);
  return url.toString().replace(/\/+$/, "");
}

export function gatewayRequestUrl(baseUrl: string, path: string): string {
  if (!path.startsWith("/")) {
    throw new Error("Gateway request path must start with /.");
  }
  return `${normalizeGatewayBaseUrl(baseUrl)}${path}`;
}

export function createGatewayClientOptions(
  options: GatewayClientOptions = {},
): ClientRequestOptions {
  const clientOptions: ClientRequestOptions = {};
  if (options.fetch) {
    clientOptions.fetch = options.fetch;
  }
  if (options.headers) {
    clientOptions.headers = options.headers;
  }
  if (options.init) {
    clientOptions.init = options.init;
  }
  return clientOptions;
}
