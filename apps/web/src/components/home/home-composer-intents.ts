import type { RunIntent } from "@cheatcode/types/api";
import type { ComponentType } from "react";
import type { ComposerWorkIntentId } from "@/components/home/home-composer.types";
import { skillAppBuildTarget } from "@/components/home/use-initial-skill";
import { FileText, Globe, Image, Smartphone, Star, TrendingUp } from "@/components/ui";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import type { AppBuildTarget } from "@/lib/app-build-target";

export type ComposerWorkIntent = {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "false" | "true" }>;
  id: ComposerWorkIntentId;
  label: string;
  placeholder: string;
  runIntent: RunIntent | null;
  skill: null | string;
  appBuildTarget: AppBuildTarget | null;
};

export const COMPOSER_WORK_INTENTS: readonly ComposerWorkIntent[] = [
  {
    appBuildTarget: "mobile",
    icon: Smartphone,
    id: "mobile-app",
    label: "Mobile app",
    placeholder: "Describe the app - I'll build it with a live phone preview",
    runIntent: null,
    skill: null,
  },
  {
    appBuildTarget: "web",
    icon: Globe,
    id: "web-app",
    label: "Web app",
    placeholder: "Describe the site or web app - I'll build and preview it",
    runIntent: null,
    skill: null,
  },
  {
    appBuildTarget: null,
    icon: Star,
    id: "slides",
    label: "Slides",
    placeholder: "What's the deck about? Audience and key points help",
    runIntent: "slides",
    skill: "pptx",
  },
  {
    appBuildTarget: null,
    icon: CheatcodeMark,
    id: "research",
    label: "Research",
    placeholder: "What should I research? I'll fan out agents and cite sources",
    runIntent: "research",
    skill: "deep-research",
  },
  {
    appBuildTarget: null,
    icon: TrendingUp,
    id: "data",
    label: "Data",
    placeholder: "Attach or describe the data - I'll profile and chart it",
    runIntent: "data",
    skill: "csv-analyst",
  },
  {
    appBuildTarget: null,
    icon: FileText,
    id: "documents",
    label: "Documents",
    placeholder: "Describe the report, memo, PDF, or document you need",
    runIntent: "documents",
    skill: null,
  },
  {
    appBuildTarget: null,
    icon: Image,
    id: "media",
    label: "Media",
    placeholder: "Describe the image or video you want to create or edit",
    runIntent: "media",
    skill: "generate-media",
  },
] as const;

export const QUICK_ACTION_PRIMARY_INTENTS = COMPOSER_WORK_INTENTS.slice(0, 2);
export const QUICK_ACTION_SECONDARY_INTENTS = COMPOSER_WORK_INTENTS.slice(2, 5);
export const QUICK_ACTION_TERTIARY_INTENTS = COMPOSER_WORK_INTENTS.slice(5);

/** The skill to attach on submit — a repo import carries no skill. */
export function resolveSubmitSkill(
  repoUrl: string | null,
  intent: ComposerWorkIntent | null,
  skillChip: string | null,
): string | null {
  if (repoUrl) {
    return null;
  }
  return intent?.skill ?? skillChip;
}

/** The app target implied by the current intent, skill, or imported repository. */
export function resolveSubmitAppBuildTarget(
  repoUrl: string | null,
  intentId: ComposerWorkIntentId | null,
  intent: ComposerWorkIntent | null,
  skillChip: string | null,
): AppBuildTarget | null {
  if (repoUrl) {
    return intentId === "mobile-app" ? "mobile" : "web";
  }
  return intent ? intent.appBuildTarget : skillAppBuildTarget(skillChip);
}
