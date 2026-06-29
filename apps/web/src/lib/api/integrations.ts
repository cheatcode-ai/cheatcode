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
import { authorizedFetch } from "@/lib/api/authorized-fetch";

export const INTEGRATIONS_QUERY = ["integrations"] as const;
export const INTEGRATION_CATALOG_QUERY = ["integration-catalog"] as const;

export async function listIntegrations(
  getToken: () => Promise<null | string>,
): Promise<Integration[]> {
  const response = await authorizedFetch(getToken, "/v1/integrations");
  return IntegrationSchema.array().parse(await response.json());
}

export async function fetchIntegrationCatalog(
  getToken: () => Promise<null | string>,
): Promise<IntegrationCatalog> {
  const response = await authorizedFetch(getToken, "/v1/integrations/catalog");
  return IntegrationCatalogSchema.parse(await response.json());
}

export async function fetchToolkitActions(
  getToken: () => Promise<null | string>,
  name: IntegrationName,
): Promise<ToolkitAction[]> {
  const response = await authorizedFetch(getToken, `/v1/integrations/${name}/tools`);
  return ToolkitActionsResponseSchema.parse(await response.json()).actions;
}

export async function connectIntegration(
  getToken: () => Promise<null | string>,
  integration: IntegrationName,
): Promise<string> {
  const response = await authorizedFetch(getToken, `/v1/integrations/${integration}/connect`, {
    method: "POST",
  });
  return IntegrationConnectResponseSchema.parse(await response.json()).oauthUrl;
}

export async function disconnectIntegration(
  getToken: () => Promise<null | string>,
  integration: IntegrationName,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/integrations/${integration}`, { method: "DELETE" });
}
