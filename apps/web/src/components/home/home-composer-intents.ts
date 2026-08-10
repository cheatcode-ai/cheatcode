import type { ComponentType } from "react";
import { skillBuildSurface } from "@/components/home/use-initial-skill";
import { Globe, Smartphone, Star, TrendingUp } from "@/components/ui";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";

export type IntentId = "data" | "mobile-app" | "research" | "slides" | "web-app";

/** Runtime/preview topology only; research, data, and slides remain work intents. */
export type BuildSurface = "mobile" | "web";

export type ComposerIntent = {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "false" | "true" }>;
  id: IntentId;
  label: string;
  placeholder: string;
  skill: null | string;
  buildSurface: BuildSurface | null;
};

export const COMPOSER_INTENTS: readonly ComposerIntent[] = [
  {
    icon: Smartphone,
    id: "mobile-app",
    label: "Mobile app",
    placeholder: "Describe the app - I'll build it with a live phone preview",
    skill: null,
    buildSurface: "mobile",
  },
  {
    icon: Globe,
    id: "web-app",
    label: "Web app",
    placeholder: "Describe the site or web app - I'll build and preview it",
    skill: null,
    buildSurface: "web",
  },
  {
    icon: Star,
    id: "slides",
    label: "Slides",
    placeholder: "What's the deck about? Audience and key points help",
    skill: "pitch-deck",
    buildSurface: null,
  },
  {
    icon: CheatcodeMark,
    id: "research",
    label: "Research",
    placeholder: "What should I research? I'll fan out agents and cite sources",
    skill: "deep-research",
    buildSurface: null,
  },
  {
    icon: TrendingUp,
    id: "data",
    label: "Data",
    placeholder: "Attach or describe the data - I'll profile and chart it",
    skill: "csv-analyst",
    buildSurface: null,
  },
] as const;

export const QUICK_ACTION_PRIMARY_INTENTS = COMPOSER_INTENTS.slice(0, 2);
export const QUICK_ACTION_SECONDARY_INTENTS = COMPOSER_INTENTS.slice(2);

/** The skill to attach on submit — a repo import carries no skill. */
export function resolveSubmitSkill(
  repoUrl: string | null,
  intent: ComposerIntent | null,
  skillChip: string | null,
): string | null {
  if (repoUrl) {
    return null;
  }
  return intent?.skill ?? skillChip;
}

/** The build surface (mobile/web/null) implied by the current intent or imported repo. */
export function resolveSubmitBuildSurface(
  repoUrl: string | null,
  intentId: IntentId | null,
  intent: ComposerIntent | null,
  skillChip: string | null,
): BuildSurface | null {
  if (repoUrl) {
    return intentId === "mobile-app" ? "mobile" : "web";
  }
  return intent ? intent.buildSurface : skillBuildSurface(skillChip);
}
