import {
  deleteProviderKey,
  listProviderKeys,
  setProviderKey,
  validateProviderKey,
} from "@cheatcode/byok";
import { createDb, lockUserProviderKeyMutations, withUserContext } from "@cheatcode/db";
import { APIError, emitUserEvent, readJsonRequest } from "@cheatcode/observability";
import { ProviderSchema, ToolDomainSchema, UpsertProviderKeySchema } from "@cheatcode/types";
import { authenticate } from "./authenticate";
import type { GatewayApp, GatewayContext } from "./gateway-env";
import { listAgentsRoute, listToolsRoute } from "./metadata-routes";
import { rateLimit } from "./rate-limit";

const MAX_PROVIDER_KEY_REQUEST_BYTES = 32 * 1024;

export function registerProviderHttpRoutes(app: GatewayApp): void {
  app.get("/v1/tools", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/tools");
    const parsedDomain = ToolDomainSchema.optional().safeParse(c.req.query("domain"));
    if (!parsedDomain.success) {
      throw new APIError(400, "invalid_query_param", "Invalid tool domain", {
        details: { issues: parsedDomain.error.issues.map((issue) => issue.message) },
        retriable: false,
      });
    }
    return listToolsRoute(parsedDomain.data);
  });
  app.get("/v1/agents", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/agents");
    return listAgentsRoute();
  });
  app.get("/v1/provider-keys", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/provider-keys");
    const { db, close } = createDb(c.env.HYPERDRIVE, {
      audience: "app_gateway",
      signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
    });
    try {
      return c.json(await withUserContext(db, userId, (tx) => listProviderKeys(tx)));
    } finally {
      c.executionCtx.waitUntil(close());
    }
  });
  app.post("/v1/provider-keys", async (c) => upsertProviderKey(c));
  app.delete("/v1/provider-keys/:provider", async (c) => deleteProviderKeyRoute(c));
}

async function upsertProviderKey(c: GatewayContext): Promise<Response> {
  const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
  await rateLimit(c, userId, "POST /v1/provider-keys");
  const parsedInput = UpsertProviderKeySchema.safeParse(
    await readJsonRequest(c.req.raw, MAX_PROVIDER_KEY_REQUEST_BYTES, "Provider key request"),
  );
  if (!parsedInput.success) {
    throw new APIError(400, "invalid_request_body", "Invalid provider key payload", {
      details: { issues: parsedInput.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const input = parsedInput.data;
  await validateProviderKey(input.provider, input.key);
  const { db, close } = createDb(c.env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    const result = await withUserContext(db, userId, async (tx) => {
      await lockUserProviderKeyMutations(tx, userId);
      const existingKeys = await listProviderKeys(tx);
      await setProviderKey(tx, input.provider, input.key);
      const keys = await listProviderKeys(tx);
      const summary =
        keys.find((key) => key.provider === input.provider) ??
        existingKeys.find((key) => key.provider === input.provider);
      return { summary, wasFirstProviderKey: existingKeys.length === 0 };
    });
    if (!result.summary) {
      throw new APIError(500, "internal_error", "Provider key was not stored", { retriable: true });
    }
    if (result.wasFirstProviderKey) {
      emitUserEvent(c.env, { eventName: "first_byok_key_added", userId });
    }
    return c.json(result.summary, 201);
  } finally {
    c.executionCtx.waitUntil(close());
  }
}

async function deleteProviderKeyRoute(c: GatewayContext): Promise<Response> {
  const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
  await rateLimit(c, userId, "DELETE /v1/provider-keys/:provider");
  const parsedProvider = ProviderSchema.safeParse(c.req.param("provider"));
  if (!parsedProvider.success) {
    throw new APIError(400, "invalid_path_param", "Invalid provider", {
      details: { issues: parsedProvider.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  const { db, close } = createDb(c.env.HYPERDRIVE, {
    audience: "app_gateway",
    signingSecret: c.env.DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY,
  });
  try {
    await withUserContext(db, userId, async (tx) => {
      await lockUserProviderKeyMutations(tx, userId);
      await deleteProviderKey(tx, parsedProvider.data);
    });
    return c.body(null, 204);
  } finally {
    c.executionCtx.waitUntil(close());
  }
}
