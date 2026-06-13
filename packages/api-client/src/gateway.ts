import type { GatewayAppType } from "@cheatcode/gateway-worker";
import { hc } from "hono/client";
import {
  createGatewayClientOptions,
  type GatewayClientOptions,
  normalizeGatewayBaseUrl,
} from "./index";

export type GatewayClient = ReturnType<typeof createGatewayClient>;

export function createGatewayClient(baseUrl: string, options: GatewayClientOptions = {}) {
  return hc<GatewayAppType>(normalizeGatewayBaseUrl(baseUrl), createGatewayClientOptions(options));
}
