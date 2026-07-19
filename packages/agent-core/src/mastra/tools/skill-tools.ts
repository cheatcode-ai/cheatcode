import { type BundledSkill, getSkillByName } from "@cheatcode/skills";
import { createTool } from "@mastra/core/tools";
import {
  userSkillCreatorFromRequestContext,
  userSkillLoaderFromRequestContext,
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
    "Load the full instructions and filesystem root for a complete Cheatcode skill package. Use rootPath as the working directory for the package's scripts, references, and assets.",
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
        rootPath: `/home/node/.cheatcode/default-skills/${bundled.name}`,
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
      rootPath: userSkill.rootPath,
    };
  },
});

export const mastraSkillCreate = createTool({
  id: "skill_create",
  description:
    "Persist a reusable custom skill. Use exactly once in Skill Creator mode after the complete package has been authored and validated.",
  inputSchema: skillCreateInputSchema,
  outputSchema: skillCreateOutputSchema,
  execute: async (input, context) => {
    const parsed = skillCreateInputSchema.parse(input);
    const creator = userSkillCreatorFromRequestContext(requestContextFromToolContext(context));
    if (!creator) {
      throw new Error("Skill creation is available only in Skill Creator mode.");
    }
    const result = await creator.create({
      body: parsed.body,
      category: parsed.category ?? "Builder & Apps",
      description: parsed.description,
      name: parsed.name,
      sourceSlug: parsed.slug,
      tags: parsed.tags ?? [],
    });
    return { created: true as const, ...result };
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
