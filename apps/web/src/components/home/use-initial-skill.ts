import { SKILL_MANIFEST } from "@cheatcode/skills/manifest";
import type { ComposerWorkIntentId } from "@/components/home/home-composer.types";
import type { AppBuildTarget } from "@/lib/app-build-target";

type SkillIntent = Extract<
  ComposerWorkIntentId,
  "data" | "documents" | "media" | "research" | "slides"
>;

// Skills that map onto an existing composer work-intent choice.
const SKILL_TO_INTENT: Record<string, SkillIntent> = {
  "csv-analyst": "data",
  "deep-research": "research",
  docx: "documents",
  "generate-media": "media",
  pdf: "documents",
  "pitch-deck": "slides",
};

// Skills that imply an app runtime target without becoming a durable project mode themselves.
const SKILL_TO_APP_BUILD_TARGET: Record<string, AppBuildTarget> = {
  "mobile-app": "mobile",
};

export interface InitialSkillResolution {
  /** The selected skill chip shown in the composer. */
  chip: string | null;
  /** Intent pill to pre-activate (pitch-deck/deep-research/csv-analyst). */
  intent: SkillIntent | null;
}

/**
 * Resolves the `?skill=` deep-link param (validated against the bundled manifest)
 * into either an intent pill to activate or a synthetic skill chip. Pure — used as
 * a lazy `useState` initializer so no effect (and nothing the dev linter strips)
 * is needed on the home composer.
 */
export function resolveInitialSkill(skill: string | null | undefined): InitialSkillResolution {
  if (!skill || !SKILL_MANIFEST.some((entry) => entry.name === skill)) {
    return { chip: null, intent: null };
  }
  const intent = SKILL_TO_INTENT[skill];
  if (intent) {
    return { chip: skill, intent };
  }
  return { chip: skill, intent: null };
}

export function skillAppBuildTarget(skill: string | null): AppBuildTarget | null {
  return skill ? (SKILL_TO_APP_BUILD_TARGET[skill] ?? null) : null;
}
