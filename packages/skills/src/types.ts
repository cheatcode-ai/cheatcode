export interface BundledSkill {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata: Record<string, unknown>;
  body: string;
  references: Record<string, string>;
  assets: Record<string, string>;
}
