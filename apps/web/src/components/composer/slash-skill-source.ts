import { SKILL_MANIFEST } from "@cheatcode/skills/manifest";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";

const MAX_SLASH_ITEMS = 8;

/**
 * Maps the bundled skill manifest + the current `/` query into menu items. The
 * manifest is browser-safe (name/description/category/tags only — no skill
 * bodies). Selecting a row inserts `/<name> ` so activation stays model-driven.
 */
export function slashSkillItems(query: string): ComposerMenuItem[] {
  const needle = query.trim().toLowerCase();
  return SKILL_MANIFEST.filter(
    (skill) => needle.length === 0 || skill.name.toLowerCase().includes(needle),
  )
    .slice(0, MAX_SLASH_ITEMS)
    .map((skill) => ({
      hint: skill.description,
      id: skill.name,
      insert: `/${skill.name} `,
      label: `/${skill.name}`,
    }));
}
