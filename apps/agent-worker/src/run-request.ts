import { APIError } from "@cheatcode/observability";
import { type CreateRun, CreateRunSchema } from "@cheatcode/types";

export function parseCreateRunRequestBody(value: unknown): CreateRun {
  const parsed = CreateRunSchema.safeParse(value);
  if (!parsed.success) {
    throw new APIError(400, "invalid_request_body", "Invalid run payload", {
      details: { issues: parsed.error.issues.map((issue) => issue.message) },
      retriable: false,
    });
  }
  return parsed.data;
}

export function extractRunMessageText(input: CreateRun): string {
  return input.message.parts
    .map((part) => part.text)
    .join("\n")
    .trim();
}
