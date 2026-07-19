import type { DaytonaClient } from "@cheatcode/tools-code";
import { z } from "zod";
import {
  APP_PREVIEW_SLOT_PREFIX,
  PROC_PREFIX,
  ProcessRecordSchema,
} from "./project-sandbox-process-support";

const RUNTIME_DIRECTORY = "/workspace/.cheatcode";
const SANDBOX_RUNTIME_MANIFEST_PATH = `${RUNTIME_DIRECTORY}/runtime.json`;

const RuntimeProjectSchema = z
  .object({
    cwd: z.string().min(1),
    isMobile: z.boolean(),
    port: z.number().int().positive().max(65_535).nullable(),
    processId: z.string().min(1),
    startupCommands: z.array(z.string().min(1)).max(4),
  })
  .strict();

const SandboxRuntimeManifestSchema = z
  .object({
    generatedAt: z.string().datetime(),
    projects: z.record(z.string(), RuntimeProjectSchema),
    source: z.literal("durable-object-process-state"),
    version: z.literal(1),
  })
  .strict();

export async function writeSandboxRuntimeManifest(
  client: DaytonaClient,
  sandboxId: string,
  records: Map<string, unknown>,
): Promise<void> {
  const manifest = buildSandboxRuntimeManifest(records);
  const temporaryPath = `${SANDBOX_RUNTIME_MANIFEST_PATH}.tmp-${crypto.randomUUID()}`;
  await client.createFolder(sandboxId, RUNTIME_DIRECTORY, "0700");
  await client.uploadFile(
    sandboxId,
    temporaryPath,
    new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
  );
  const moved = await client.execute(sandboxId, {
    command: `mv -f ${shellQuote(temporaryPath)} ${shellQuote(SANDBOX_RUNTIME_MANIFEST_PATH)}`,
    timeout: 10,
  });
  if (moved.exitCode !== 0) {
    await client.deleteFilePath(sandboxId, temporaryPath, false).catch(() => undefined);
    throw new Error("Could not publish the sandbox runtime projection.");
  }
}

function buildSandboxRuntimeManifest(
  records: Map<string, unknown>,
): z.infer<typeof SandboxRuntimeManifestSchema> {
  const projects: Record<string, z.infer<typeof RuntimeProjectSchema>> = {};
  for (const [key, value] of [...records.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const processId = key.slice(PROC_PREFIX.length);
    if (!key.startsWith(PROC_PREFIX) || !processId.startsWith(APP_PREVIEW_SLOT_PREFIX)) {
      continue;
    }
    const parsed = ProcessRecordSchema.safeParse(value);
    if (!parsed.success) continue;
    const workspaceSlug = processId.slice(APP_PREVIEW_SLOT_PREFIX.length);
    if (!/^[a-z0-9][a-z0-9-]{0,119}$/u.test(workspaceSlug)) continue;
    projects[workspaceSlug] = {
      cwd: parsed.data.cwd,
      isMobile: parsed.data.isMobile ?? false,
      port: parsed.data.port ?? null,
      processId,
      startupCommands: [parsed.data.command],
    };
  }
  return SandboxRuntimeManifestSchema.parse({
    generatedAt: new Date().toISOString(),
    projects,
    source: "durable-object-process-state",
    version: 1,
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
