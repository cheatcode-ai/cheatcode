"use client";

import { USER_MESSAGE_MAX_CHARACTERS } from "@cheatcode/types";
import { ArrowUp, Paperclip, Square } from "@cheatcode/ui";
import type { PromptComposerController } from "@/components/chat/prompt-composer-controller";
import { ComposerAttachmentStatus } from "@/components/composer/composer-attachment-status";
import { ComposerContextChips } from "@/components/composer/composer-context-chips";
import { COMPOSER_TEXTAREA_CLASS, ComposerFrame } from "@/components/composer/composer-frame";
import { ComposerPopover } from "@/components/composer/composer-popover";
import { ModelMenu } from "@/components/composer/model-menu";
import { ProjectPicker } from "@/components/composer/project-picker";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { PROMPT_ATTACHMENT_ACCEPT } from "@/lib/input/prompt-attachments";
import { cn } from "@/lib/ui/cn";

const PROMPT_COMPOSER_FORM_BASE =
  "absolute right-0 bottom-0 left-0 z-10 bg-gradient-to-t from-background via-background/95 to-transparent pt-14 transition-[padding-bottom] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none";

export function PromptComposerView({ controller }: { controller: PromptComposerController }) {
  return (
    <form
      className={promptComposerFormClass(controller.state.computerOpen)}
      onSubmit={controller.actions.handleSubmit}
    >
      <div className="relative z-10 mx-auto flex w-full max-w-[740px] flex-col justify-end px-3 sm:px-4">
        <ComposerSuggestions controller={controller} />
        <ComposerFrame fillClassName="min-h-[124px]" isWorking={controller.state.isRunning}>
          <ComposerInput controller={controller} />
          <ComposerActions controller={controller} />
        </ComposerFrame>
      </div>
    </form>
  );
}

function ComposerSuggestions({ controller }: { controller: PromptComposerController }) {
  if (!controller.state.isMenuOpen) {
    return null;
  }
  return (
    <ComposerPopover
      activeIndex={controller.triggers.activeIndex}
      ariaLabel={controller.state.menuAriaLabel}
      items={controller.state.menuItems}
      onHoverIndex={controller.triggers.setActiveIndex}
      onSelectIndex={(index) => controller.triggers.commitIndex(index, controller.state.menuItems)}
    />
  );
}

function ComposerInput({ controller }: { controller: PromptComposerController }) {
  const selectionHandler = controller.triggers.onTextareaSelect;
  return (
    <div className="flex min-h-[80px] flex-col gap-1 px-0">
      <ComposerContextChips
        className="px-2 pt-3"
        onClearSkill={controller.actions.clearSkill}
        onClearTool={controller.actions.clearTool}
        skill={controller.state.selectedSkill}
        tool={controller.state.selectedTool}
      />
      <ComposerAttachmentStatus className="px-2 pt-3" status={controller.attachments.status} />
      <div className="flex items-start gap-2">
        <label className="sr-only" htmlFor="prompt">
          Message Cheatcode
        </label>
        <textarea
          className={cn(
            COMPOSER_TEXTAREA_CLASS,
            controller.state.selectedSkill ||
              controller.state.selectedTool ||
              controller.attachments.status
              ? "pt-2"
              : "pt-4",
          )}
          id="prompt"
          maxLength={USER_MESSAGE_MAX_CHARACTERS}
          onChange={controller.triggers.onTextareaChange}
          onClick={selectionHandler}
          onKeyDown={controller.actions.handleKeyDown}
          onKeyUp={selectionHandler}
          onSelect={selectionHandler}
          placeholder="Ask anything, @ for skills, / for files"
          ref={controller.meta.textareaRef}
          rows={1}
          value={controller.state.value}
        />
      </div>
    </div>
  );
}

function ComposerActions({ controller }: { controller: PromptComposerController }) {
  return (
    <div className="relative flex items-center justify-between gap-1.5 px-0 max-[340px]:gap-1 sm:gap-3">
      <div className="z-10 flex min-w-0 items-center gap-1.5 max-[340px]:gap-1 sm:gap-2">
        <AttachmentButton controller={controller} />
        <ProjectPicker
          compact={controller.state.computerOpen}
          onSelect={controller.actions.selectProject}
          selectedProject={controller.state.selectedProject}
          variant="thread"
        />
      </div>
      <div className="z-10 flex shrink-0 items-center gap-1 max-[340px]:gap-0.5 sm:gap-2">
        <ModelMenu
          compact={controller.state.computerOpen}
          onOpenChange={controller.actions.setModelMenuOpen}
          open={controller.state.openControlMenu === "model"}
          resolvedModelId={controller.state.resolvedModelId}
          variant="thread"
        />
        <SendActionButton
          canSubmit={controller.state.canSubmit}
          isRunning={controller.state.isRunning}
        />
      </div>
    </div>
  );
}

function AttachmentButton({ controller }: { controller: PromptComposerController }) {
  return (
    <>
      <input
        aria-label="Upload files to project"
        accept={PROMPT_ATTACHMENT_ACCEPT}
        className="sr-only"
        multiple
        onChange={controller.attachments.onFileChange}
        ref={controller.attachments.inputRef}
        tabIndex={-1}
        type="file"
      />
      <CheatcodeTooltip label="Upload to project">
        <button
          aria-label="Upload files to project"
          className="flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-background hover:text-foreground"
          onClick={controller.attachments.openPicker}
          type="button"
        >
          <Paperclip aria-hidden="true" className="h-4 w-4" />
        </button>
      </CheatcodeTooltip>
    </>
  );
}

function SendActionButton({ canSubmit, isRunning }: { canSubmit: boolean; isRunning: boolean }) {
  return (
    <CheatcodeTooltip label={isRunning ? "Stop agent" : "Send message"}>
      <button
        aria-label={isRunning ? "Stop agent" : "Send message"}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90",
          !canSubmit && !isRunning && "cursor-not-allowed bg-secondary text-placeholder",
        )}
        disabled={!canSubmit && !isRunning}
        type="submit"
      >
        {isRunning ? (
          <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
        ) : (
          <ArrowUp aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
    </CheatcodeTooltip>
  );
}

function promptComposerFormClass(computerOpen: boolean): string {
  return cn(PROMPT_COMPOSER_FORM_BASE, computerOpen ? "pb-2" : "pb-3 md:pb-10");
}
