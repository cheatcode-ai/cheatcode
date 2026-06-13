import { SKILL_MANIFEST } from "@cheatcode/skills/manifest";

export type SkillIntent = "data" | "research" | "slides";
export type SkillSurface = "mobile" | "web";

// Skills that map onto an existing intent pill (the design's slide/research/data lanes).
const SKILL_TO_INTENT: Record<string, SkillIntent> = {
  "csv-analyst": "data",
  "deep-research": "research",
  "pitch-deck": "slides",
};

// Skills that fix the build surface but have no intent pill.
const SKILL_TO_SURFACE: Record<string, SkillSurface> = {
  "landing-page": "web",
  "mobile-app": "mobile",
};

export interface InitialSkillResolution {
  /** Synthetic removable chip when the skill maps to no intent pill. */
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
    return { chip: null, intent };
  }
  return { chip: skill, intent: null };
}

export function skillSurface(skill: string | null): SkillSurface | null {
  return skill ? (SKILL_TO_SURFACE[skill] ?? null) : null;
}
