/** Minimal lifetime capability shared by Hono and Cloudflare fetch contexts. */
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}
