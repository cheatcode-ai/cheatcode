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

// Tool providers require a top-level object schema. Keep the provider-facing shape object-based,
// then narrow it to the driver's method-specific union before crossing the sandbox boundary.
export const BrowserActInputSchema = z
  .strictObject({
    method: BrowserActionMethodSchema.describe("Deterministic action to perform on the ref."),
    ref: BrowserElementRefSchema,
    targetRef: BrowserElementRefSchema.optional().describe(
      "Destination ref. Required only for dragAndDrop; omit for every other method.",
    ),
    value: z
      .string()
      .max(2_000)
      .optional()
      .describe(
        "Text, key, option, or percentage. Required for fill, press, scrollTo, selectOptionFromDropdown, and type; omit otherwise.",
      ),
  })
  .refine((input) => BrowserBoundActionSchema.safeParse(input).success, {
    message: "The selected browser method requires its exact method-specific fields.",
  })
  .describe("One method-specific action using an exact ref from the latest browser tree.");

export function browserBoundActionFromInput(
  input: z.infer<typeof BrowserActInputSchema>,
): z.infer<typeof BrowserBoundActionSchema> {
  return BrowserBoundActionSchema.parse(input);
}
