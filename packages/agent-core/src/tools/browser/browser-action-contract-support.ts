import { z } from "zod";

const BrowserElementRefSchema = z
  .string()
  .regex(/^\d+-\d+$/u)
  .max(64)
  .describe("Exact hyphenated element ref from the latest browser_observe or browser_act tree.");

const BrowserActionMethodSchema = z.enum([
  "click",
  "doubleClick",
  "dragAndDrop",
  "fill",
  "hover",
  "nextChunk",
  "press",
  "prevChunk",
  "scrollTo",
  "selectOptionFromDropdown",
  "type",
]);

const BrowserNoValueActionMethodSchema = BrowserActionMethodSchema.exclude([
  "dragAndDrop",
  "fill",
  "press",
  "scrollTo",
  "selectOptionFromDropdown",
  "type",
]);

const BrowserValueActionMethodSchema = z.enum([
  "fill",
  "press",
  "scrollTo",
  "selectOptionFromDropdown",
  "type",
]);

interface BrowserActInput {
  method: z.infer<typeof BrowserActionMethodSchema>;
  ref: string;
  targetRef: string | null;
  value: string | null;
}

type BrowserValueActionMethod = z.infer<typeof BrowserValueActionMethodSchema>;

export const BrowserBoundActionSchema = z.union([
  z.strictObject({
    method: BrowserNoValueActionMethodSchema.describe(
      "Deterministic action to perform on the ref.",
    ),
    ref: BrowserElementRefSchema,
  }),
  z.strictObject({
    method: BrowserValueActionMethodSchema.describe(
      "Deterministic value-taking action to perform on the ref.",
    ),
    ref: BrowserElementRefSchema,
    value: z
      .string()
      .max(2_000)
      .describe("Text, key, option, or percentage required by this method."),
  }),
  z.strictObject({
    method: z.literal("dragAndDrop"),
    ref: BrowserElementRefSchema,
    targetRef: BrowserElementRefSchema.describe("Destination ref for the drag operation."),
  }),
]);

export const BrowserActInputSchema = z
  .strictObject({
    method: BrowserActionMethodSchema.describe(
      "Deterministic action to perform on the exact ref from the latest browser tree.",
    ),
    ref: BrowserElementRefSchema,
    targetRef: BrowserElementRefSchema.nullable().describe(
      "Destination ref for dragAndDrop; null for every other method.",
    ),
    value: z
      .string()
      .min(1)
      .max(2_000)
      .nullable()
      .describe(
        "Text, key, option, or percentage for fill, press, scrollTo, selectOptionFromDropdown, and type; null for every other method.",
      ),
  })
  .superRefine(validateBrowserActInput);

function validateBrowserActInput(input: BrowserActInput, context: z.RefinementCtx): void {
  if (input.method === "dragAndDrop") {
    requireDragTarget(input, context);
    return;
  }
  if (isValueActionMethod(input.method)) {
    if (input.value === null) {
      addIssue(context, "value", `${input.method} requires value.`);
    }
  } else if (input.value !== null) {
    addIssue(context, "value", `${input.method} does not accept value.`);
  }
  if (input.targetRef !== null) {
    addIssue(context, "targetRef", `${input.method} does not accept targetRef.`);
  }
}

function requireDragTarget(input: BrowserActInput, context: z.RefinementCtx): void {
  if (input.targetRef === null) {
    addIssue(context, "targetRef", "dragAndDrop requires targetRef.");
  }
  if (input.value !== null) {
    addIssue(context, "value", "dragAndDrop does not accept value.");
  }
}

function addIssue(context: z.RefinementCtx, path: "targetRef" | "value", message: string): void {
  context.addIssue({ code: "custom", message, path: [path] });
}

export function browserBoundActionFromInput(
  input: z.infer<typeof BrowserActInputSchema>,
): z.infer<typeof BrowserBoundActionSchema> {
  if (input.method === "dragAndDrop") {
    if (input.targetRef === null) {
      throw new Error("Validated dragAndDrop input is missing targetRef.");
    }
    return { method: input.method, ref: input.ref, targetRef: input.targetRef };
  }
  if (isValueActionMethod(input.method)) {
    if (input.value === null) {
      throw new Error(`Validated ${input.method} input is missing value.`);
    }
    return { method: input.method, ref: input.ref, value: input.value };
  }
  return { method: input.method, ref: input.ref };
}

function isValueActionMethod(
  method: BrowserActInput["method"],
): method is BrowserValueActionMethod {
  return BrowserValueActionMethodSchema.options.some((candidate) => candidate === method);
}
