"use client";

import {
  type IntegrationName,
  type ProjectSummary,
  USER_MESSAGE_MAX_CHARACTERS,
} from "@cheatcode/types";
import { ArrowUp, X } from "@cheatcode/ui";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { AuthModal } from "@/components/auth/auth-modal";
import { AddMenu } from "@/components/composer/add-menu";
import {
  ComposerAttachmentStatus,
  type ComposerAttachmentStatusState,
} from "@/components/composer/composer-attachment-status";
import { ComposerContextChips } from "@/components/composer/composer-context-chips";
import { COMPOSER_TEXTAREA_CLASS, ComposerFrame } from "@/components/composer/composer-frame";
import { ComposerPopover } from "@/components/composer/composer-popover";
import { ModelMenu } from "@/components/composer/model-menu";
import { ProjectPicker } from "@/components/composer/project-picker";
import type { ComposerTriggers } from "@/components/composer/use-composer-triggers";
import {
  HomeQuickActions,
  RemovableChip,
  SkillCreatorSuggestions,
} from "@/components/home/home-composer-controls";
import type { ComposerIntent, IntentId } from "@/components/home/home-composer-intents";
import { SandboxUsageBanner } from "@/components/home/home-composer-plan-banner";
import { repoLabel } from "@/components/home/home-composer-prompt-state";
import {
  type HomeComposerProps,
  useHomeComposerController,
} from "@/components/home/use-home-composer-controller";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { PROMPT_ATTACHMENT_ACCEPT } from "@/lib/input/prompt-attachments";
import { cn } from "@/lib/ui/cn";

export function HomeComposer(props: HomeComposerProps) {
  const controller = useHomeComposerController(props);
  return (
    <div className="mt-6 w-full">
      <QuickActionsPortal
        activeIntentId={controller.state.intentId}
        onIntentClick={controller.actions.selectQuickIntent}
        onSkillCreatorPick={controller.actions.publishValue}
        skillCreatorMode={controller.state.skillCreatorMode}
        slot={props.quickActionsSlot}
      />
      <HomeComposerForm controller={controller} />
      <ComposerSignUpModal
        onClose={controller.actions.closeAuthModal}
        redirectTo={controller.state.authRedirectTo}
      />
    </div>
  );
}

type HomeComposerController = ReturnType<typeof useHomeComposerController>;

function HomeComposerForm({ controller }: { controller: HomeComposerController }) {
  return (
    <form className="mt-8 w-full" onSubmit={controller.actions.submit}>
      <div className="relative z-10 mx-auto flex w-full max-w-[708px] flex-col gap-0">
        <SandboxUsageBanner getToken={controller.meta.getToken} />
        <HomeSlashPopover controller={controller} />
        <ComposerFrame fillClassName="min-h-[143px] sm:min-h-[124px]">
          <HomeComposerEditor {...homeEditorProps(controller)} />
          <HomeComposerToolbar {...homeToolbarProps(controller)} />
        </ComposerFrame>
      </div>
    </form>
  );
}

function HomeSlashPopover({ controller }: { controller: HomeComposerController }) {
  if (!controller.menu.isOpen) return null;
  return (
    <ComposerPopover
      activeIndex={controller.menu.triggers.activeIndex}
      ariaLabel={controller.menu.ariaLabel}
      items={controller.menu.items}
      onHoverIndex={controller.menu.triggers.setActiveIndex}
      onSelectIndex={(index) => controller.menu.triggers.commitIndex(index, controller.menu.items)}
    />
  );
}

interface HomeComposerEditorProps {
  attachmentStatus: ComposerAttachmentStatusState | null;
  onClearSkill: () => void;
  onClearTool: () => void;
  onExitSkillCreator: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  skillChip: string | null;
  skillCreatorMode: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  toolChip: IntegrationName | null;
  triggers: ComposerTriggers;
  value: string;
}

function homeEditorProps(controller: HomeComposerController): HomeComposerEditorProps {
  return {
    attachmentStatus: controller.state.attachmentStatus,
    onClearSkill: controller.actions.clearSkillSelection,
    onClearTool: controller.actions.clearTool,
    onExitSkillCreator: controller.actions.exitSkillCreator,
    onKeyDown: controller.actions.handleKeyDown,
    placeholder: controller.state.placeholder,
    skillChip: controller.state.skillChip,
    skillCreatorMode: controller.state.skillCreatorMode,
    textareaRef: controller.refs.textareaRef,
    toolChip: controller.state.toolChip,
    triggers: controller.menu.triggers,
    value: controller.state.value,
  };
}

function HomeComposerEditor(props: HomeComposerEditorProps) {
  return (
    <div>
      <SkillCreatorBadge active={props.skillCreatorMode} onExit={props.onExitSkillCreator} />
      <ComposerContextChips
        className="px-2 pt-3"
        onClearSkill={props.onClearSkill}
        onClearTool={props.onClearTool}
        skill={props.skillChip}
        tool={props.toolChip}
      />
      <ComposerAttachmentStatus className="px-2 pt-3" status={props.attachmentStatus} />
      <label className="sr-only" htmlFor="home-prompt">
        Message Cheatcode
      </label>
      <textarea
        className={cn(
          COMPOSER_TEXTAREA_CLASS,
          props.skillChip || props.toolChip || props.skillCreatorMode || props.attachmentStatus
            ? "pt-2"
            : "pt-4",
        )}
        id="home-prompt"
        maxLength={USER_MESSAGE_MAX_CHARACTERS}
        onChange={props.triggers.onTextareaChange}
        onClick={props.triggers.onTextareaSelect}
        onKeyDown={props.onKeyDown}
        onKeyUp={props.triggers.onTextareaSelect}
        onSelect={props.triggers.onTextareaSelect}
        placeholder={props.placeholder}
        ref={props.textareaRef}
        rows={1}
        value={props.value}
      />
    </div>
  );
}

interface HomeComposerToolbarProps {
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  canSubmit: boolean;
  intent: ComposerIntent | null;
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearIntent: () => void;
  onOpenFilePicker: () => void;
  onProjectSelect: (project: ProjectSummary | null) => void;
  onRemoveRepo: () => void;
  onRepoAttach: (url: string) => void;
  onSubmit: () => void;
  repoUrl: string | null;
  selectedProject: ProjectSummary | null;
}

function homeToolbarProps(controller: HomeComposerController): HomeComposerToolbarProps {
  return {
    attachmentInputRef: controller.refs.attachmentInputRef,
    canSubmit: controller.state.canSubmit,
    intent: controller.state.intent,
    onAttachmentChange: controller.actions.handleAttachmentChange,
    onClearIntent: controller.actions.clearIntent,
    onOpenFilePicker: controller.actions.openFilePicker,
    onProjectSelect: controller.actions.handleSelectProject,
    onRemoveRepo: controller.actions.clearRepo,
    onRepoAttach: controller.actions.handleRepoAttach,
    onSubmit: () => controller.actions.submit(),
    repoUrl: controller.state.repoUrl,
    selectedProject: controller.state.selectedProject,
  };
}

function HomeComposerToolbar(props: HomeComposerToolbarProps) {
  return (
    <div className="flex min-h-[47px] items-center justify-between sm:min-h-0 sm:gap-3">
      <HomeComposerContextControls {...props} />
      <HomeComposerSubmitControls canSubmit={props.canSubmit} onSubmit={props.onSubmit} />
    </div>
  );
}

function HomeComposerContextControls(props: HomeComposerToolbarProps) {
  return (
    <div className="flex min-w-0 items-center gap-0.5 sm:flex-wrap sm:gap-2">
      <input
        aria-label="Upload files to project"
        accept={PROMPT_ATTACHMENT_ACCEPT}
        className="sr-only"
        multiple
        onChange={props.onAttachmentChange}
        ref={props.attachmentInputRef}
        tabIndex={-1}
        type="file"
      />
      <AddMenu
        allowRepoImport={props.selectedProject === null}
        onRepoAttach={props.onRepoAttach}
        onUploadClick={props.onOpenFilePicker}
      />
      <HomeProjectPicker
        onSelect={props.onProjectSelect}
        repoUrl={props.repoUrl}
        selectedProject={props.selectedProject}
      />
      <HomeIntentChip intent={props.intent} onClear={props.onClearIntent} />
      <HomeRepoChip onClear={props.onRemoveRepo} repoUrl={props.repoUrl} />
    </div>
  );
}

function HomeComposerSubmitControls({
  canSubmit,
  onSubmit,
}: {
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
      <ModelMenu variant="home" />
      <button
        aria-label="Send message"
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
          canSubmit
            ? "bg-foreground text-background hover:bg-foreground/90"
            : "cursor-not-allowed bg-secondary text-placeholder",
        )}
        disabled={!canSubmit}
        onClick={onSubmit}
        type="button"
      >
        <ArrowUp aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

function QuickActionsPortal({
  activeIntentId,
  onIntentClick,
  onSkillCreatorPick,
  skillCreatorMode,
  slot,
}: {
  activeIntentId: IntentId | null;
  onIntentClick: (intentId: IntentId) => void;
  onSkillCreatorPick: (text: string) => void;
  skillCreatorMode: boolean;
  slot: HTMLElement | null | undefined;
}) {
  if (!slot) {
    return null;
  }
  return createPortal(
    skillCreatorMode ? (
      <SkillCreatorSuggestions onPick={onSkillCreatorPick} />
    ) : (
      <HomeQuickActions activeIntentId={activeIntentId} onIntentClick={onIntentClick} />
    ),
    slot,
  );
}

function SkillCreatorBadge({ active, onExit }: { active: boolean; onExit: () => void }) {
  if (!active) {
    return null;
  }
  return (
    <div className="px-3 pt-3">
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-bg-elevated py-0.5 pr-1 pl-2.5 font-medium text-[13px] text-foreground">
        <CheatcodeMark aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#a9842e]" />
        Skill Creator
        <button
          aria-label="Exit Skill Creator"
          className="flex size-6 items-center justify-center rounded-full text-placeholder transition-colors hover:bg-fg-primary/5 hover:text-foreground"
          onClick={onExit}
          type="button"
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

function HomeProjectPicker({
  onSelect,
  repoUrl,
  selectedProject,
}: {
  onSelect: (project: ProjectSummary | null) => void;
  repoUrl: string | null;
  selectedProject: ProjectSummary | null;
}) {
  if (repoUrl) {
    return null;
  }
  return <ProjectPicker onSelect={onSelect} selectedProject={selectedProject} />;
}

function HomeIntentChip({
  intent,
  onClear,
}: {
  intent: ComposerIntent | null;
  onClear: () => void;
}) {
  if (!intent) {
    return null;
  }
  return (
    <div className="hidden h-8 items-center gap-2 rounded-full bg-background px-3 text-[12px] text-foreground shadow-[0_0_1px_rgba(0,0,0,0.08),inset_0_0_2px_rgba(0,0,0,0.02)] sm:flex">
      <intent.icon aria-hidden="true" className="h-3.5 w-3.5" />
      <span>{intent.label}</span>
      <button
        aria-label={`Clear ${intent.label} intent`}
        className="-mr-1.5 ml-0.5 flex h-6 w-6 items-center justify-center text-placeholder transition-colors hover:text-foreground"
        onClick={onClear}
        type="button"
      >
        <X aria-hidden="true" className="h-3 w-3" />
      </button>
    </div>
  );
}

function HomeRepoChip({ onClear, repoUrl }: { onClear: () => void; repoUrl: string | null }) {
  if (!repoUrl) {
    return null;
  }
  return <RemovableChip label={repoLabel(repoUrl)} onClear={onClear} title={repoUrl} />;
}

function ComposerSignUpModal({
  onClose,
  redirectTo,
}: {
  onClose: () => void;
  redirectTo: string | null;
}) {
  if (!redirectTo) {
    return null;
  }
  return <AuthModal mode="sign-up" onClose={onClose} open={true} redirectTo={redirectTo} />;
}
