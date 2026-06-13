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
 * Writes a redacted sandbox-exec audit record to R2. Relocated out of
 * `project-sandbox.ts` to keep that file under the line cap (preview §10).
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

function auditObjectKey(entry: SandboxExecAuditEntry): string {
  const day = entry.timestamp.slice(0, 10);
  const month = entry.timestamp.slice(0, 7);
  const id = crypto.randomUUID();
  return `sandbox-exec/${month}/${day}/${entry.sandboxId}/${entry.processName}-${id}.json`;
}
