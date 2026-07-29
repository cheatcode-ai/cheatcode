import {
  deleteProviderKey,
  listProviderKeys,
  setProviderKey,
  validateProviderKey,
} from "@cheatcode/byok";
import { lockUserProviderKeyMutations, withUserDb } from "@cheatcode/db";
import { APIError, emitUserEvent, readJsonRequest } from "@cheatcode/observability";
import { ProviderSchema, UpsertProviderKeySchema } from "@cheatcode/types/api";
import { authenticate } from "./authenticate";
import { type GatewayApp, type GatewayContext, requestDatabase } from "./gateway-env";
import { rateLimit } from "./rate-limit";

const MAX_PROVIDER_KEY_REQUEST_BYTES = 32 * 1024;

export function registerProviderHttpRoutes(app: GatewayApp): void {
  app.get("/v1/provider-keys", async (c) => {
    const userId = await authenticate(c);
    await rateLimit(c, userId);
    return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
      return c.json(await transaction((tx) => listProviderKeys(tx)));
    });
  });
  app.post("/v1/provider-keys", async (c) => upsertProviderKey(c));
  app.delete("/v1/provider-keys/:provider", async (c) => deleteProviderKeyRoute(c));
}

async function upsertProviderKey(c: GatewayContext): Promise<Response> {
  const userId = await authenticate(c);
  await rateLimit(c, userId);
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
  return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
    const result = await transaction(async (tx) => {
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
  });
}

async function deleteProviderKeyRoute(c: GatewayContext): Promise<Response> {
  const userId = await authenticate(c);
  await rateLimit(c, userId);
  const parsedProvider = ProviderSchema.safeParse(c.req.param("provider"));
  if (!parsedProvider.success) {
    throw new APIError(400, "invalid_path_param", "Invalid provider", {
      details: { issues: parsedProvider.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return withUserDb(requestDatabase(c), userId, async ({ transaction }) => {
    await transaction(async (tx) => {
      await lockUserProviderKeyMutations(tx, userId);
      await deleteProviderKey(tx, parsedProvider.data);
    });
    return c.body(null, 204);
  });
}
