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
  const items: ComposerMenuItem[] = [];
  const append = (name: string, description: string) => {
    if (
      items.length < MAX_SLASH_ITEMS &&
      (needle.length === 0 || name.toLowerCase().includes(needle))
    ) {
      items.push({ hint: description, id: name, insert: "", label: name });
    }
  };

  for (const skill of userSkills) {
    if (!bundledNames.has(skill.name)) {
      append(skill.name, skill.description);
    }
  }
  for (const skill of SKILL_MANIFEST) {
    append(skill.name, skill.description);
  }
  return items;
}
