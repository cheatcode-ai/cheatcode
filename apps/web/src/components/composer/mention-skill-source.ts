import type { ConnectedAppSkill, UserSkill } from "@cheatcode/types/api";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";

const MAX_MENTION_ITEMS = 200;

/**
 * Builds the custom-skill and connected-app catalog used by the `@` trigger.
 */
export function mentionSkillItems(
  query: string,
  userSkills: UserSkill[] = [],
  connectedApps: readonly ConnectedAppSkill[] = [],
): ComposerMenuItem[] {
  const needle = query.trim().toLowerCase();
  const items: ComposerMenuItem[] = [];
  for (const skill of userSkills) {
    if (matchesQuery(skill.name, skill.description, needle) && items.length < MAX_MENTION_ITEMS) {
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
  for (const app of connectedApps) {
    const hint = `Use ${app.displayName} through your connected account.`;
    if (matchesQuery(app.displayName, hint, needle) && items.length < MAX_MENTION_ITEMS) {
      items.push({
        hint,
        id: `integration:${app.name}`,
        insert: "",
        integrationName: app.name,
        label: app.displayName,
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
