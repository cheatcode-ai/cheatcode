"use client";

import type { IntegrationName } from "@cheatcode/types";
import { useQuery } from "@tanstack/react-query";
import type { KeyboardEvent, RefObject } from "react";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";
import { mentionSkillItems } from "@/components/composer/mention-skill-source";
import { useProjectFileItems } from "@/components/composer/project-file-source";
import {
  type ComposerTriggers,
  type TriggerDetector,
  useComposerTriggers,
} from "@/components/composer/use-composer-triggers";
import { COMPOSER_SKILLS_QUERY, fetchComposerSkills } from "@/lib/api/skills";
import { detectMentionToken, detectSlashToken } from "@/lib/input/caret-tokens";
import { emitComposerEvent } from "@/lib/telemetry/user-events";

const COMPOSER_SOURCES: readonly TriggerDetector[] = [
  { detect: detectSlashToken, kind: "slash" },
  { detect: detectMentionToken, kind: "mention" },
];

interface UseComposerMenuOptions {
  getToken: () => Promise<null | string>;
  onChange: (value: string) => void;
  onSelectSkill: (skill: string) => void;
  onSelectTool: (tool: IntegrationName) => void;
  projectId: string | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
}

export interface ComposerMenuController {
  ariaLabel: string;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  isOpen: boolean;
  items: readonly ComposerMenuItem[];
  triggers: ComposerTriggers;
}

export function useComposerMenu(options: UseComposerMenuOptions): ComposerMenuController {
  const skillsCatalog = useQuery({
    queryFn: ({ signal }) => fetchComposerSkills(options.getToken, signal),
    queryKey: COMPOSER_SKILLS_QUERY,
    staleTime: 60_000,
  });
  const triggers = useComposerTriggers({
    onChange: options.onChange,
    onInsert: (kind, item) => {
      if (kind === "mention") {
        selectComposerItem(item, options.onSelectSkill, options.onSelectTool);
      }
      emitComposerEvent(
        options.getToken,
        kind === "mention" ? "composer_mention_inserted" : "composer_slash_inserted",
      );
    },
    sources: COMPOSER_SOURCES,
    textareaRef: options.textareaRef,
    value: options.value,
  });
  const fileItems = useProjectFileItems({
    enabled: triggers.kind === "slash",
    projectId: options.projectId,
    query: triggers.query,
  });
  const items =
    triggers.kind === "slash"
      ? fileItems
      : skillMenuItems(triggers.query, skillsCatalog.data, skillsCatalog.isPending);
  return {
    ariaLabel: triggers.kind === "slash" ? "Project files" : "Skills",
    handleKeyDown: (event) => triggers.handleMenuKeyDown(event, items),
    isOpen: triggers.isActive && items.length > 0,
    items,
    triggers,
  };
}

function selectComposerItem(
  item: ComposerMenuItem,
  onSelectSkill: (skill: string) => void,
  onSelectTool: (tool: IntegrationName) => void,
): void {
  if (item.integrationName) {
    onSelectTool(item.integrationName);
  } else if (item.skillName) {
    onSelectSkill(item.skillName);
  }
}

function skillMenuItems(
  query: string,
  catalog: Awaited<ReturnType<typeof fetchComposerSkills>> | undefined,
  isPending: boolean,
): ComposerMenuItem[] {
  const items = mentionSkillItems(query, catalog?.skills, catalog?.connectedApps);
  if (items.length > 0) {
    return items;
  }
  const label = isPending ? "Loading skills…" : "No matching skills";
  return [{ disabled: true, id: `status:${label}`, insert: "", label, visual: "status" }];
}
