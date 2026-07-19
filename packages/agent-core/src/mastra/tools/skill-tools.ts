import { type BundledSkill, getSkillByName } from "@cheatcode/skills";
import { createTool } from "@mastra/core/tools";
import { userSkillLoaderFromRequestContext } from "../system-prompt";
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
    "Prepare a reusable custom skill for the user's review. Use once in Skill Creator mode when the name, description, and markdown instructions are ready. The user must explicitly create the proposed skill before it is saved.",
  inputSchema: skillCreateInputSchema,
  outputSchema: skillCreateOutputSchema,
  execute: async (input) => {
    const parsed = skillCreateInputSchema.parse(input);
    return {
      body: parsed.body,
      category: parsed.category ?? "Builder & Apps",
      description: parsed.description,
      name: parsed.name,
      proposalId: crypto.randomUUID(),
      proposed: true as const,
      slug: skillSlug(parsed.name),
      tags: parsed.tags ?? [],
    };
  },
});

function skillSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 80);
  return slug || "custom-skill";
}

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
