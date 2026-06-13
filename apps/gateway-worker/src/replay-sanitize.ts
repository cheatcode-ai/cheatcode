import { redactSecrets } from "@cheatcode/observability";
import type { UIMessagePart } from "@cheatcode/types";

/**
 * Defense-in-depth sanitizer for a public replay transcript (replays plan §4.3).
 *
 * The operator already vets the curated thread, so this is a safety net — not a
 * per-user feature — but it runs on every response because persisted parts can
 * carry live, token-gated capability URLs (sandbox preview/expo URLs, signed
 * artifact download URLs + output IDs), private spend, and user-pasted secrets.
 *
 * Policy is allowlist-based (`default: DROP`): only explicitly handled part
 * types survive, several transformed to strip their sensitive fields. Text is
 * scrubbed through the canonical {@link redactSecrets} (valid JS `RegExp`
 * literals with flags — never inline `(?i)` modifiers, which throw in the
 * Workers V8 engine). New/unknown part types drop by default, so the surface
 * cannot regress into leaking a future part shape.
 */
export function sanitizeReplayParts(parts: UIMessagePart[]): UIMessagePart[] {
  const sanitized: UIMessagePart[] = [];
  for (const part of parts) {
    const result = sanitizePart(part);
    if (result) {
      sanitized.push(result);
    }
  }
  return sanitized;
}

/** Part types kept verbatim: structural / task progress with nothing sensitive emitted today. */
const KEEP_VERBATIM_PART_TYPES = new Set(["data-plan", "data-task-status"]);

function sanitizePart(part: UIMessagePart): UIMessagePart | null {
  switch (part.type) {
    case "text":
      // KEEP, after the redaction pass scrubs any pasted secret in user text.
      return redactSecrets(part);
    case "step-start":
      return { type: "step-start" };
    case "data-sandbox-status":
      return sanitizeSandboxStatus(part);
    case "data-artifact":
      return sanitizeArtifact(part);
    case "data-error":
      return sanitizeError(part);
    case "source-url":
      return sanitizeSourceUrl(part);
    case "source-document":
      return sanitizeSourceDocument(part);
    default:
      return KEEP_VERBATIM_PART_TYPES.has(part.type) ? part : null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Strip `previewUrl`/`expoUrl`: live (possibly token-gated) capability URLs into the demo sandbox. */
function sanitizeSandboxStatus(part: UIMessagePart): UIMessagePart {
  const data = asRecord(part["data"]);
  return { type: "data-sandbox-status", data: { v: 1, status: data["status"] } };
}

/** Strip `downloadUrl` + `outputId`: signed URLs grant file access; output IDs enable probing. */
function sanitizeArtifact(part: UIMessagePart): UIMessagePart {
  const data = asRecord(part["data"]);
  const filename = data["filename"];
  const sizeBytes = data["sizeBytes"];
  return {
    type: "data-artifact",
    data: {
      v: 1,
      downloadUrl: "",
      ...(typeof filename === "string" ? { filename } : {}),
      kind: data["kind"],
      mimeType: data["mimeType"],
      outputId: "",
      ...(typeof sizeBytes === "number" ? { sizeBytes } : {}),
    },
  };
}

/** Keep the failure visible (replay honesty) but blank `message`: provider strings can echo identifiers. */
function sanitizeError(part: UIMessagePart): UIMessagePart {
  const data = asRecord(part["data"]);
  return {
    type: "data-error",
    data: { v: 1, code: data["code"], message: "", retriable: data["retriable"] },
  };
}

/** Research citation: keep url/title only; drop any `providerMetadata`; redact defensively. */
function sanitizeSourceUrl(part: UIMessagePart): UIMessagePart {
  const sourceId = part["sourceId"];
  const url = part["url"];
  const title = part["title"];
  return {
    type: "source-url",
    ...(typeof sourceId === "string" ? { sourceId } : {}),
    ...(typeof url === "string" ? { url: redactSecrets(url) } : {}),
    ...(typeof title === "string" ? { title: redactSecrets(title) } : {}),
  };
}

/** Research citation document: keep title/filename/mediaType only; drop `providerMetadata`. */
function sanitizeSourceDocument(part: UIMessagePart): UIMessagePart {
  const sourceId = part["sourceId"];
  const mediaType = part["mediaType"];
  const title = part["title"];
  const filename = part["filename"];
  return {
    type: "source-document",
    ...(typeof sourceId === "string" ? { sourceId } : {}),
    ...(typeof mediaType === "string" ? { mediaType } : {}),
    ...(typeof title === "string" ? { title: redactSecrets(title) } : {}),
    ...(typeof filename === "string" ? { filename: redactSecrets(filename) } : {}),
  };
}
