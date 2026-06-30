import { SKILL_MANIFEST } from "@cheatcode/skills/manifest";
import type { UserSkill } from "@cheatcode/types";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";

const MAX_SLASH_ITEMS = 10;

/**
 * Maps the caller's custom skills + the bundled skill manifest + the current `/`
 * query into menu items. The manifest is browser-safe (name/description/category/
 * tags — no bodies); user skills come from `/v1/skills` (also body-less). A user
 * skill that shadows a bundled name is dropped (bundled wins, matching the agent's
 * `skill_invoke` resolution order). Custom skills are listed FIRST so they surface
 * in the empty-query menu rather than being sliced off behind the 8 bundled ones.
 * Selecting a row removes the slash token and lets the composer render the selected
 * skill as a chip, then prepend `/<name> ` on submit — name-based, so bundled and
 * custom invoke identically.
 */
export function slashSkillItems(query: string, userSkills: UserSkill[] = []): ComposerMenuItem[] {
  const needle = query.trim().toLowerCase();
  const bundledNames = new Set(SKILL_MANIFEST.map((skill) => skill.name));
  const entries = [
    ...userSkills
      .filter((skill) => !bundledNames.has(skill.name))
      .map((skill) => ({ description: skill.description, name: skill.name })),
    ...SKILL_MANIFEST.map((skill) => ({ description: skill.description, name: skill.name })),
  ];
  return entries
    .filter((skill) => needle.length === 0 || skill.name.toLowerCase().includes(needle))
    .slice(0, MAX_SLASH_ITEMS)
    .map((skill) => ({
      hint: skill.description,
      id: skill.name,
      insert: "",
      label: skill.name,
    }));
}
