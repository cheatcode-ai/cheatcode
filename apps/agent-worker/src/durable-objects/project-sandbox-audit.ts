import { redactSecrets } from "@cheatcode/observability";

export interface SandboxExecAuditEntry {
  argc: number;
  argv0: string;
  cwd: string;
  durationMs: number;
  error?: Record<string, unknown>;
  exitCode?: number;
  processName: string;
  sandboxId: string;
  status: string;
  success: boolean;
  timestamp: string;
  type: "sandbox_exec";
}

/**
 * Writes a redacted sandbox-exec audit record to R2. Kept outside
 * `project-sandbox.ts` so execution auditing remains independently bounded.
 */
export async function writeExecAudit(
  bucket: R2Bucket,
  entry: SandboxExecAuditEntry,
): Promise<void> {
  await bucket.put(auditObjectKey(entry), JSON.stringify(redactSecrets(entry)), {
    customMetadata: {
      sandboxId: entry.sandboxId,
      status: entry.status,
      type: entry.type,
    },
    httpMetadata: {
      contentType: "application/json",
    },
  });
}

/** Reduce an argv executable to a bounded, non-secret R2 key segment. */
export function sandboxExecProcessName(argv0: string): string {
  const executable = argv0.split(/[\\/]/u).at(-1) ?? "process";
  return sanitizeKeySegment(executable) || "process";
}

function auditObjectKey(entry: SandboxExecAuditEntry): string {
  const day = entry.timestamp.slice(0, 10);
  const month = entry.timestamp.slice(0, 7);
  const id = crypto.randomUUID();
  return `sandbox-exec/${month}/${day}/${sanitizeKeySegment(entry.sandboxId)}/${sanitizeKeySegment(entry.processName)}-${id}.json`;
}

function sanitizeKeySegment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}
