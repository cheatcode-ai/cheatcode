import {
  IntegrationCatalogSchema,
  IntegrationConnectResponseSchema,
  IntegrationSchema,
  ProviderKeySummarySchema,
  ToolkitActionsResponseSchema,
  UpsertProviderKeySchema,
} from "@cheatcode/types";
import type { JsonValue } from "./openapi-builder";
import { zodJsonSchema } from "./openapi-zod";

export const integrationSchemas: Record<string, JsonValue> = {
  Integration: zodJsonSchema(IntegrationSchema),
  IntegrationCatalog: zodJsonSchema(IntegrationCatalogSchema),
  IntegrationConnect: zodJsonSchema(IntegrationConnectResponseSchema),
  ProviderKeySummary: zodJsonSchema(ProviderKeySummarySchema),
  ToolkitActionsResponse: zodJsonSchema(ToolkitActionsResponseSchema),
  UpsertProviderKey: zodJsonSchema(UpsertProviderKeySchema, "input"),
};
