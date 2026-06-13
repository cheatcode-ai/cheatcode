import { APIError } from "@cheatcode/observability";
import { type CreateRun, CreateRunSchema } from "@cheatcode/types";

const DEFAULT_WEEK_ONE_MESSAGE = "Run Python in the Cheatcode sandbox.";

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
  const text = input.message.parts
    .filter((part) => part.type === "text" && typeof part["text"] === "string")
    .map((part) => String(part["text"]))
    .join("\n")
    .trim();
  return text.length > 0 ? text : DEFAULT_WEEK_ONE_MESSAGE;
}
