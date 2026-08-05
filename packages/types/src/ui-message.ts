import type { UIMessage } from "ai";
import { z } from "zod";
import { ArtifactKindSchema, OutputIdSchema } from "./artifacts";
import type { AgentRunId, UserId } from "./ids";
import { type LogicalModelId, LogicalModelIdSchema } from "./models";

const TaskStatusSchema = z.enum(["pending", "running", "completed", "failed"]);
const SandboxStreamStatusSchema = z.enum(["starting", "ready", "failed"]);
const AppPreviewStreamStatusSchema = z.enum(["building", "ready"]);

/**
 * Informational model-transition part. Replaces the silent text-delta fallback
 * notice and explains why routing changed.
 */
const ModelFallbackDataSchema = z.strictObject({
  v: z.literal(1),
  fromModel: LogicalModelIdSchema,
  toModel: LogicalModelIdSchema,
  reason: z.enum(["rate_limit", "provider_balance", "provider_error"]),
});

/* retained for historical transcripts */
const PlanDataSchema = z.strictObject({
  v: z.literal(1),
  parallelGroups: z.array(z.array(z.number().int().nonnegative())),
  tasks: z.array(
    z.strictObject({
      id: z.string().min(1),
      status: TaskStatusSchema,
      title: z.string().min(1),
    }),
  ),
});

const TaskStatusDataSchema = z.strictObject({
  v: z.literal(1),
  error: z.string().optional(),
  status: TaskStatusSchema,
  taskId: z.string().min(1),
});

const SandboxStatusDataSchema = z.strictObject({
  v: z.literal(1),
  status: SandboxStreamStatusSchema,
});

const AppPreviewStatusDataSchema = z.strictObject({
  v: z.literal(1),
  status: AppPreviewStreamStatusSchema,
});

const ProjectCreatedDataSchema = z.strictObject({
  v: z.literal(1),
  projectId: z.string().uuid(),
  projectName: z.string().min(1).max(200),
});

const SkillCreatedDataSchema = z.strictObject({
  v: z.literal(1),
  description: z.string().min(1).max(400).optional(),
  filePath: z.string().min(1).max(1_000).optional(),
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(80).optional(),
});

const RunIntentDataSchema = z.strictObject({
  v: z.literal(1),
  intent: z.literal("skill-creator"),
});

const ArtifactDataSchema = z.strictObject({
  v: z.literal(1),
  filename: z.string().min(1),
  kind: ArtifactKindSchema,
  mimeType: z.string().min(1),
  outputId: OutputIdSchema,
  sizeBytes: z.number().int().nonnegative(),
});

const ToolDataSchema = z.strictObject({
  v: z.literal(1),
  input: z.record(z.string(), z.unknown()).optional(),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
});

const ErrorDataSchema = z.strictObject({
  v: z.literal(1),
  code: z.string().min(1),
  message: z.string(),
  retriable: z.boolean(),
});

export const TRANSCRIPT_FRAGMENT_PAYLOAD_MAX_CHARACTERS = 16 * 1024;

/** Lossless transport envelope for one UI part that is larger than a transcript segment. */
const TranscriptFragmentDataSchema = z.strictObject({
  v: z.literal(1),
  final: z.boolean(),
  index: z.number().int().nonnegative(),
  partId: z.string().min(1).max(64),
  payload: z.string().max(TRANSCRIPT_FRAGMENT_PAYLOAD_MAX_CHARACTERS),
});

const SeqDataSchema = z.strictObject({
  v: z.literal(1),
  seq: z.number().int().nonnegative(),
});

export const CHEATCODE_DATA_SCHEMAS = {
  "app-preview-status": AppPreviewStatusDataSchema,
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

const TextMessagePartSchema = z.strictObject({
  state: z.enum(["streaming", "done"]).default("done"),
  text: z.string(),
  type: z.literal("text"),
});
function dataMessagePartSchema<Name extends keyof typeof CHEATCODE_DATA_SCHEMAS>(name: Name) {
  return z.strictObject({
    data: CHEATCODE_DATA_SCHEMAS[name],
    id: z.string().optional(),
    type: z.literal(`data-${name}`),
  });
}

/** Exact V2 message-part contract persisted in Postgres and replayed to the web client. */
export const MessagePartSchema = z.discriminatedUnion("type", [
  TextMessagePartSchema,
  dataMessagePartSchema("app-preview-status"),
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
export type AppPreviewState = "idle" | z.infer<typeof AppPreviewStreamStatusSchema>;
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
