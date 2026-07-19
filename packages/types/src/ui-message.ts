import type { UIMessage } from "ai";
import { z } from "zod";
import { ArtifactKindSchema, OutputIdSchema } from "./artifacts";
import type { AgentRunId, UserId } from "./ids";
import { type LogicalModelId, LogicalModelIdSchema } from "./models";

const TaskStatusSchema = z.enum(["pending", "running", "completed", "failed"]);
const SandboxStreamStatusSchema = z.enum(["starting", "ready", "failed"]);

/**
 * Informational model-transition part. Replaces the silent text-delta fallback
 * notice and explains why routing changed.
 */
export const ModelFallbackDataSchema = z
  .object({
    v: z.literal(1),
    fromModel: LogicalModelIdSchema,
    toModel: LogicalModelIdSchema,
    reason: z.enum(["rate_limit", "provider_balance", "provider_error"]),
  })
  .strict();

const PlanDataSchema = z
  .object({
    v: z.literal(1),
    parallelGroups: z.array(z.array(z.number().int().nonnegative())),
    tasks: z.array(
      z
        .object({
          id: z.string().min(1),
          status: TaskStatusSchema,
          title: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

const TaskStatusDataSchema = z
  .object({
    v: z.literal(1),
    error: z.string().optional(),
    status: TaskStatusSchema,
    taskId: z.string().min(1),
  })
  .strict();

const SandboxStatusDataSchema = z
  .object({
    v: z.literal(1),
    status: SandboxStreamStatusSchema,
  })
  .strict();

const ProjectCreatedDataSchema = z
  .object({
    v: z.literal(1),
    projectId: z.string().uuid(),
    projectName: z.string().min(1).max(200),
  })
  .strict();

const SkillCreatedDataSchema = z
  .object({
    v: z.literal(1),
    description: z.string().min(1).max(400).optional(),
    filePath: z.string().min(1).max(1_000).optional(),
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(80),
    slug: z.string().min(1).max(80).optional(),
  })
  .strict();

const RunIntentDataSchema = z
  .object({
    v: z.literal(1),
    intent: z.literal("skill-creator"),
  })
  .strict();

const ArtifactDataSchema = z
  .object({
    v: z.literal(1),
    filename: z.string().min(1),
    kind: ArtifactKindSchema,
    mimeType: z.string().min(1),
    outputId: OutputIdSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

const ToolDataSchema = z
  .object({
    v: z.literal(1),
    input: z.record(z.string(), z.unknown()).optional(),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
  })
  .strict();

const ErrorDataSchema = z
  .object({
    v: z.literal(1),
    code: z.string().min(1),
    message: z.string(),
    retriable: z.boolean(),
  })
  .strict();

export const TRANSCRIPT_FRAGMENT_PAYLOAD_MAX_CHARACTERS = 16 * 1024;

/** Lossless transport envelope for one UI part that is larger than a transcript segment. */
export const TranscriptFragmentDataSchema = z
  .object({
    v: z.literal(1),
    final: z.boolean(),
    index: z.number().int().nonnegative(),
    partId: z.string().min(1).max(64),
    payload: z.string().max(TRANSCRIPT_FRAGMENT_PAYLOAD_MAX_CHARACTERS),
  })
  .strict();

const SeqDataSchema = z
  .object({
    v: z.literal(1),
    seq: z.number().int().nonnegative(),
  })
  .strict();

export const CHEATCODE_DATA_SCHEMAS = {
  artifact: ArtifactDataSchema,
  error: ErrorDataSchema,
  "model-fallback": ModelFallbackDataSchema,
  plan: PlanDataSchema,
  "project-created": ProjectCreatedDataSchema,
  "run-intent": RunIntentDataSchema,
  "sandbox-status": SandboxStatusDataSchema,
  "skill-created": SkillCreatedDataSchema,
  seq: SeqDataSchema,
  "task-status": TaskStatusDataSchema,
  tool: ToolDataSchema,
  "transcript-fragment": TranscriptFragmentDataSchema,
} as const;

const TextMessagePartSchema = z
  .object({
    state: z.enum(["streaming", "done"]).default("done"),
    text: z.string(),
    type: z.literal("text"),
  })
  .strict();
function dataMessagePartSchema<Name extends keyof typeof CHEATCODE_DATA_SCHEMAS>(name: Name) {
  return z
    .object({
      data: CHEATCODE_DATA_SCHEMAS[name],
      id: z.string().optional(),
      type: z.literal(`data-${name}`),
    })
    .strict();
}

/** Exact V2 message-part contract persisted in Postgres and replayed to the web client. */
export const MessagePartSchema = z.discriminatedUnion("type", [
  TextMessagePartSchema,
  dataMessagePartSchema("artifact"),
  dataMessagePartSchema("error"),
  dataMessagePartSchema("model-fallback"),
  dataMessagePartSchema("plan"),
  dataMessagePartSchema("project-created"),
  dataMessagePartSchema("run-intent"),
  dataMessagePartSchema("sandbox-status"),
  dataMessagePartSchema("skill-created"),
  dataMessagePartSchema("task-status"),
  dataMessagePartSchema("tool"),
  dataMessagePartSchema("transcript-fragment"),
]);

export type ModelFallbackData = z.infer<typeof ModelFallbackDataSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type SandboxState = "cold" | z.infer<typeof SandboxStreamStatusSchema>;

type CheatcodeDataParts = {
  [DataPart in keyof typeof CHEATCODE_DATA_SCHEMAS]: z.infer<
    (typeof CHEATCODE_DATA_SCHEMAS)[DataPart]
  >;
};

type CheatcodeMetadata = {
  modelId?: LogicalModelId;
  runId?: AgentRunId;
  transcriptSegment?: {
    agentRunId: AgentRunId;
    index: number;
    isFinal: boolean;
  };
  userId?: UserId;
};

type CheatcodeUIMessageBase = UIMessage<
  CheatcodeMetadata,
  CheatcodeDataParts,
  Record<never, never>
>;
type MessagePartType = z.input<typeof MessagePartSchema>["type"];

type ClientMessagePart = Extract<
  CheatcodeUIMessageBase["parts"][number],
  { type: MessagePartType }
>;

export type UIMessagePart = z.input<typeof MessagePartSchema>;

/** Validates one part against the exact persisted V2 message contract. */
export function parseMessagePart(value: unknown): UIMessagePart {
  return MessagePartSchema.parse(value);
}

export const MessagePartsSchema = z
  .array(MessagePartSchema)
  .transform((parts): ClientMessagePart[] => parts as ClientMessagePart[]);

export type CheatcodeUIMessage = CheatcodeUIMessageBase & {
  parts: ClientMessagePart[];
};
