export const SKILL_CATEGORIES = ["Builder & Apps", "Research & Docs", "Data & Media"] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export interface BundledSkill {
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  license?: string;
  compatibility?: string;
  metadata: Record<string, unknown>;
  body: string;
  references: Record<string, string>;
  assets: Record<string, string>;
}

/**
 * Client-safe projection of a bundled skill. Never carries `body`, `references`,
 * or `assets`, so importing the generated manifest cannot pull skill corpora into
 * a browser bundle.
 */
export interface SkillManifestEntry {
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
}
