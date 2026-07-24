import type { ToolkitCatalogEntry, UserSkill } from "@cheatcode/types";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";

const MAX_SLASH_ITEMS = 200;

/**
 * Builds the skill catalog used by the `@` composer trigger. The optional toolkit
 * input remains available to non-composer callers, while chat intentionally passes
 * skills only so `@` has one predictable meaning.
 */
export function slashSkillItems(
  query: string,
  userSkills: UserSkill[] = [],
  toolkits: readonly ToolkitCatalogEntry[] = [],
): ComposerMenuItem[] {
  const needle = query.trim().toLowerCase();
  const items: ComposerMenuItem[] = [];
  for (const skill of userSkills) {
    if (matchesQuery(skill.name, skill.description, needle) && items.length < MAX_SLASH_ITEMS) {
      items.push({
        hint: skill.description,
        id: `user-skill:${skill.id}`,
        insert: "",
        label: skill.name,
        skillName: skill.name,
        visual: "user-skill",
      });
    }
  }
  for (const toolkit of toolkits) {
    if (
      matchesQuery(toolkit.displayName, toolkit.description, needle) &&
      items.length < MAX_SLASH_ITEMS
    ) {
      items.push({
        hint: toolkit.description,
        id: `integration:${toolkit.name}`,
        insert: "",
        integrationName: toolkit.name,
        label: toolkit.displayName,
        visual: "integration",
      });
    }
  }
  return items;
}

function matchesQuery(name: string, description: string, needle: string): boolean {
  return (
    needle.length === 0 ||
    name.toLowerCase().includes(needle) ||
    description.toLowerCase().includes(needle)
  );
}
