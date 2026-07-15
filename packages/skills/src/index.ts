import { SKILLS } from "./generated";
import type { BundledSkill } from "./types";

export type { BundledSkill } from "./types";
export { SKILLS };

export function buildSystemPromptSection(skills: BundledSkill[] = SKILLS): string {
  return [
    "## Skills",
    "",
    "These are proven playbooks for specific jobs. When a request matches one of these descriptions, load its full step-by-step instructions with skill_invoke (by name) before you start, and follow them.",
    "",
    ...skills.map((skill) => `- **${skill.name}**: ${skill.description}`),
  ].join("\n");
}

export function getSkillByName(name: string): BundledSkill | undefined {
  return SKILLS.find((skill) => skill.name === name);
}
