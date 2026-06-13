import { SKILLS } from "./generated";
import type { BundledSkill } from "./types";

export type { BundledSkill } from "./types";
export { SKILLS };

export function buildSystemPromptSection(skills: BundledSkill[] = SKILLS): string {
  return [
    "## Available Skills",
    "",
    "Match user requests to these descriptions, then invoke the matching skill when detailed instructions are needed.",
    "",
    ...skills.map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n");
}

export function getSkillByName(name: string): BundledSkill | undefined {
  return SKILLS.find((skill) => skill.name === name);
}
