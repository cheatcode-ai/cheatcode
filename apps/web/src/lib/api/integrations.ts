"use client";

import {
  type Integration,
  type IntegrationCatalog,
  IntegrationCatalogSchema,
  IntegrationConnectResponseSchema,
  type IntegrationName,
  IntegrationSchema,
  type ToolkitAction,
  ToolkitActionsResponseSchema,
} from "@cheatcode/types";
import {
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

export const INTEGRATIONS_QUERY = ["integrations"] as const;
export const INTEGRATION_CATALOG_QUERY = ["integration-catalog"] as const;

export async function listIntegrations(
  getToken: () => Promise<null | string>,
): Promise<Integration[]> {
  const response = await authorizedFetch(getToken, "/v1/integrations");
  return IntegrationSchema.array().parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.integrations),
  );
}

export async function fetchIntegrationCatalog(
  getToken: () => Promise<null | string>,
): Promise<IntegrationCatalog> {
  const response = await authorizedFetch(getToken, "/v1/integrations/catalog");
  return IntegrationCatalogSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.integrations),
  );
}

export async function fetchToolkitActions(
  getToken: () => Promise<null | string>,
  name: IntegrationName,
): Promise<ToolkitAction[]> {
  const response = await authorizedFetch(getToken, `/v1/integrations/${name}/tools`);
  return ToolkitActionsResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.integrations),
  ).actions;
}

export async function connectIntegration(
  getToken: () => Promise<null | string>,
  integration: IntegrationName,
): Promise<string> {
  const response = await authorizedFetch(getToken, `/v1/integrations/${integration}/connect`, {
    method: "POST",
  });
  return IntegrationConnectResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.integrations),
  ).oauthUrl;
}

export async function disconnectIntegrationAccount(
  getToken: () => Promise<null | string>,
  integration: IntegrationName,
  connectionId: string,
): Promise<void> {
  await authorizedFetch(
    getToken,
    `/v1/integrations/${integration}/accounts/${encodeURIComponent(connectionId)}`,
    { method: "DELETE" },
  );
}

export async function makeIntegrationAccountDefault(
  getToken: () => Promise<null | string>,
  integration: IntegrationName,
  connectionId: string,
): Promise<void> {
  await authorizedFetch(
    getToken,
    `/v1/integrations/${integration}/accounts/${encodeURIComponent(connectionId)}/default`,
    { method: "POST" },
  );
}
