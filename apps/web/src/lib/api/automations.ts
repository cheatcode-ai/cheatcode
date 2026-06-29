"use client";

import {
  type AutomationListResponse,
  AutomationListResponseSchema,
  type AutomationRunSummary,
  AutomationRunsResponseSchema,
  type AutomationSummary,
  AutomationSummarySchema,
  type CreateAutomation,
  type UpdateAutomation,
} from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

type GetToken = () => Promise<null | string>;

export async function listAutomations(getToken: GetToken): Promise<AutomationSummary[]> {
  const response = await authorizedFetch(getToken, "/v1/automations");
  const page: AutomationListResponse = AutomationListResponseSchema.parse(await response.json());
  return page.automations;
}

export async function createAutomation(
  getToken: GetToken,
  input: CreateAutomation,
): Promise<AutomationSummary> {
  const response = await authorizedFetch(getToken, "/v1/automations", {
    body: JSON.stringify(input),
    method: "POST",
  });
  return AutomationSummarySchema.parse(await response.json());
}

export async function updateAutomation(
  getToken: GetToken,
  id: string,
  patch: UpdateAutomation,
): Promise<AutomationSummary> {
  const response = await authorizedFetch(getToken, `/v1/automations/${encodeURIComponent(id)}`, {
    body: JSON.stringify(patch),
    method: "PATCH",
  });
  return AutomationSummarySchema.parse(await response.json());
}

export async function deleteAutomation(getToken: GetToken, id: string): Promise<void> {
  await authorizedFetch(getToken, `/v1/automations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function runAutomationNow(getToken: GetToken, id: string): Promise<void> {
  await authorizedFetch(getToken, `/v1/automations/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
}

export async function listAutomationRuns(
  getToken: GetToken,
  id: string,
): Promise<AutomationRunSummary[]> {
  const response = await authorizedFetch(
    getToken,
    `/v1/automations/${encodeURIComponent(id)}/runs`,
  );
  const page = AutomationRunsResponseSchema.parse(await response.json());
  return page.runs;
}
