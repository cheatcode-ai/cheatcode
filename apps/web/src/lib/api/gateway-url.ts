import { env } from "@cheatcode/env/web";

const GATEWAY_ORIGIN = new URL(env.NEXT_PUBLIC_GATEWAY_URL);

/** Resolves a root-relative API path without permitting an origin escape. */
export function gatewayRequestUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error("Gateway request path must start with /.");
  }

  const resolved = new URL(path, GATEWAY_ORIGIN);
  if (resolved.origin !== GATEWAY_ORIGIN.origin) {
    throw new Error("Gateway request path must stay on the configured gateway origin.");
  }
  return resolved.toString();
}
