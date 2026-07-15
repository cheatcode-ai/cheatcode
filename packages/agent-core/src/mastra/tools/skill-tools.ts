import { type BundledSkill, getSkillByName } from "@cheatcode/skills";
import { createTool } from "@mastra/core/tools";
import {
  userSkillLoaderFromRequestContext,
  userSkillStoreFromRequestContext,
} from "../system-prompt";
import { requestContextFromToolContext } from "./tool-runtime-context";
import {
  skillCreateInputSchema,
  skillCreateOutputSchema,
  skillInvokeInputSchema,
  skillInvokeOutputSchema,
  skillReadReferenceInputSchema,
  skillReadReferenceOutputSchema,
} from "./tool-schemas";

function requiredSkill(skillName: string): BundledSkill {
  const skill = getSkillByName(skillName);
  if (!skill) {
    throw new Error(`Bundled skill not found: ${skillName}`);
  }
  return skill;
}

function sortedRecordKeys(record: Record<string, string>): string[] {
  return Object.keys(record).sort();
}

export const mastraSkillInvoke = createTool({
  id: "skill_invoke",
  description:
    "Load the full instructions for a bundled Cheatcode skill. Use when the request matches a listed skill description.",
  inputSchema: skillInvokeInputSchema,
  outputSchema: skillInvokeOutputSchema,
  execute: async (input, context) => {
    const parsedInput = skillInvokeInputSchema.parse(input);
    const bundled = getSkillByName(parsedInput.skillName);
    if (bundled) {
      return {
        assets: sortedRecordKeys(bundled.assets),
        compatibility: bundled.compatibility,
        description: bundled.description,
        instructions: bundled.body,
        license: bundled.license,
        name: bundled.name,
        references: sortedRecordKeys(bundled.references),
      };
    }
    const loader = userSkillLoaderFromRequestContext(requestContextFromToolContext(context));
    const userSkill = await loader?.load(parsedInput.skillName);
    if (!userSkill) {
      throw new Error(`Skill not found: ${parsedInput.skillName}`);
    }
    return {
      assets: [],
      description: userSkill.description,
      instructions: userSkill.body,
      name: userSkill.name,
      references: [],
    };
  },
});

export const mastraSkillCreate = createTool({
  id: "skill_create",
  description:
    "Save a reusable custom skill for this user. Use in Skill Creator mode once the skill (name, one-line description, and markdown instructions) is ready. Re-using a name updates that skill.",
  inputSchema: skillCreateInputSchema,
  outputSchema: skillCreateOutputSchema,
  execute: async (input, context) => {
    const parsed = skillCreateInputSchema.parse(input);
    const store = userSkillStoreFromRequestContext(requestContextFromToolContext(context));
    if (!store) {
      throw new Error("Saving skills is not available in this run.");
    }
    await store.save({
      body: parsed.body,
      description: parsed.description,
      name: parsed.name,
      ...(parsed.category ? { category: parsed.category } : {}),
      ...(parsed.tags ? { tags: parsed.tags } : {}),
    });
    return { name: parsed.name, saved: true };
  },
});

export const mastraSkillReadReference = createTool({
  id: "skill_read_reference",
  description:
    "Read a reference file bundled with a Cheatcode skill after skill_invoke says it is available.",
  inputSchema: skillReadReferenceInputSchema,
  outputSchema: skillReadReferenceOutputSchema,
  execute: async (input) => {
    const parsedInput = skillReadReferenceInputSchema.parse(input);
    const skill = requiredSkill(parsedInput.skillName);
    return {
      content: skill.references[parsedInput.filename] ?? null,
      filename: parsedInput.filename,
      skillName: skill.name,
    };
  },
});
