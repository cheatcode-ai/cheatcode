import { z } from "zod";

const RawMorphCompletionSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().min(1).max(2_000_000),
              })
              .strip(),
          })
          .strip(),
      )
      .min(1)
      .max(16),
  })
  .strip();

export function parseMorphCompletion(value: unknown): string {
  const completion = RawMorphCompletionSchema.parse(value);
  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new TypeError("Morph returned an empty completion");
  }
  return content;
}
