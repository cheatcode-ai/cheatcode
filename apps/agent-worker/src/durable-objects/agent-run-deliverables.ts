import {
  listReferencedProjectGeneratedOutputs,
  type ReferencedProjectGeneratedOutputRecord,
  withUserDb,
} from "@cheatcode/db";
import { APIError, type createLogger } from "@cheatcode/observability";
import { toProjectId, toUserId } from "@cheatcode/types";
import { ProjectDeliverableRelativePathSchema } from "@cheatcode/types/api";
import { GENERATED_OUTPUT_MAX_BYTES } from "@cheatcode/types/artifacts";
import type { AgentRunEnv } from "./agent-run-env";
import type { StartRunInput } from "./agent-run-schemas";
import type { ProjectSandbox } from "./project-sandbox";

const DELIVERABLE_REFERENCE_PATTERN =
  /(?:^|\s)(\/deliverables\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-z0-9._-]+)(?=\s|$)/gu;
const MAX_REFERENCED_DELIVERABLES = 10;

interface DeliverableReference {
  filename: string;
  outputId: string;
}

interface RestoreReferencedDeliverablesOptions {
  env: AgentRunEnv;
  input: StartRunInput;
  logger: ReturnType<typeof createLogger>;
  sandbox: DurableObjectStub<ProjectSandbox>;
}

/** Restores only explicitly referenced durable outputs into their deterministic project paths. */
export async function restoreReferencedDeliverables(
  options: RestoreReferencedDeliverablesOptions,
): Promise<void> {
  const references = parseDeliverableReferences(options.input.messageText);
  if (references.length === 0) return;
  const { projectId, workspaceSlug } = options.input;
  if (!projectId || !workspaceSlug) throw referencedDeliverableNotFound();
  const outputs = await loadReferencedOutputs(
    options.env,
    options.input.userId,
    projectId,
    references,
  );
  const byId = new Map(outputs.map((output) => [output.id, output]));
  for (const reference of references) {
    const output = byId.get(reference.outputId);
    if (!output || output.filename !== reference.filename) throw referencedDeliverableNotFound();
    const bytes = await readVerifiedOutput(options.env.R2_OUTPUTS, output);
    await options.sandbox.restoreGeneratedOutput({
      bytes,
      filename: reference.filename,
      outputId: reference.outputId,
      projectId,
      workspaceSlug,
    });
  }
  options.logger.info("project_deliverables_restored", {
    projectId,
    restoredFileCount: references.length,
  });
}

function parseDeliverableReferences(message: string): DeliverableReference[] {
  const references = new Map<string, DeliverableReference>();
  for (const match of message.matchAll(DELIVERABLE_REFERENCE_PATTERN)) {
    const source = match[1];
    if (!source) continue;
    const parsed = ProjectDeliverableRelativePathSchema.safeParse(source.slice(1));
    if (!parsed.success) continue;
    const [, outputId, filename] = parsed.data.split("/");
    if (!outputId || !filename) continue;
    references.set(outputId, { filename, outputId });
    if (references.size > MAX_REFERENCED_DELIVERABLES) {
      throw new APIError(
        422,
        "request_body_invalid",
        `Reference at most ${MAX_REFERENCED_DELIVERABLES} deliverables in one message.`,
        { retriable: false },
      );
    }
  }
  return [...references.values()];
}

async function loadReferencedOutputs(
  env: AgentRunEnv,
  sourceUserId: string,
  sourceProjectId: string,
  references: readonly DeliverableReference[],
): Promise<ReferencedProjectGeneratedOutputRecord[]> {
  const userId = toUserId(sourceUserId);
  return withUserDb(env, userId, async ({ transaction }) => {
    return transaction((tx) =>
      listReferencedProjectGeneratedOutputs(tx, {
        outputIds: references.map((reference) => reference.outputId),
        projectId: toProjectId(sourceProjectId),
        userId,
      }),
    );
  });
}

async function readVerifiedOutput(
  bucket: R2Bucket,
  output: ReferencedProjectGeneratedOutputRecord,
): Promise<Uint8Array<ArrayBuffer>> {
  const object = await bucket.get(output.r2Key);
  const metadata = object?.customMetadata;
  const checksum = object?.checksums.sha256;
  if (
    !object ||
    object.key !== output.r2Key ||
    object.size <= 0 ||
    object.size > GENERATED_OUTPUT_MAX_BYTES ||
    object.httpMetadata?.contentType !== output.mimeType ||
    metadata?.["filename"] !== output.filename ||
    metadata?.["outputId"] !== output.id ||
    !metadata["contentSha256"] ||
    !checksum ||
    bytesToHex(new Uint8Array(checksum)) !== metadata["contentSha256"]
  ) {
    throw referencedDeliverableInvalid();
  }
  const bytes = new Uint8Array(await object.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  if (bytes.byteLength !== object.size) throw referencedDeliverableInvalid();
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function referencedDeliverableNotFound(): APIError {
  return new APIError(
    404,
    "resource_output_not_found",
    "A referenced deliverable is unavailable.",
    {
      hint: "Choose the file again from the project file menu.",
      retriable: false,
    },
  );
}

function referencedDeliverableInvalid(): APIError {
  return new APIError(
    409,
    "conflict_state_invalid",
    "A referenced deliverable could not be restored safely.",
    { retriable: false },
  );
}
