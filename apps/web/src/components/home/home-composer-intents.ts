import type { ComponentType } from "react";
import { skillSurface } from "@/components/home/use-initial-skill";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { Globe, Smartphone, Star, TrendingUp } from "@/components/ui/icons";

export type IntentId = "data" | "mobile-app" | "research" | "slides" | "web-app";

export type ComposerIntent = {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "false" | "true" }>;
  id: IntentId;
  label: string;
  placeholder: string;
  skill: null | string;
  surface: "mobile" | "web" | null;
};

export const COMPOSER_INTENTS: readonly ComposerIntent[] = [
  {
    icon: Smartphone,
    id: "mobile-app",
    label: "Mobile app",
    placeholder: "Describe the app - I'll build it with a live phone preview",
    skill: null,
    surface: "mobile",
  },
  {
    icon: Globe,
    id: "web-app",
    label: "Web app",
    placeholder: "Describe the site or web app - I'll build and preview it",
    skill: null,
    surface: "web",
  },
  {
    icon: Star,
    id: "slides",
    label: "Slides",
    placeholder: "What's the deck about? Audience and key points help",
    skill: "pitch-deck",
    surface: null,
  },
  {
    icon: CheatcodeMark,
    id: "research",
    label: "Research",
    placeholder: "What should I research? I'll fan out agents and cite sources",
    skill: "deep-research",
    surface: null,
  },
  {
    icon: TrendingUp,
    id: "data",
    label: "Data",
    placeholder: "Attach or describe the data - I'll profile and chart it",
    skill: "csv-analyst",
    surface: null,
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
export function resolveSubmitSurface(
  repoUrl: string | null,
  intentId: IntentId | null,
  intent: ComposerIntent | null,
  skillChip: string | null,
): "mobile" | "web" | null {
  if (repoUrl) {
    return intentId === "mobile-app" ? "mobile" : "web";
  }
  return intent ? intent.surface : skillSurface(skillChip);
}
