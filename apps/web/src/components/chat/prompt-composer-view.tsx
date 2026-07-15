"use client";

import { USER_MESSAGE_MAX_CHARACTERS } from "@cheatcode/types";
import type { PromptComposerController } from "@/components/chat/prompt-composer-controller";
import type { VoiceInputState } from "@/components/chat/use-voice-input";
import { ComposerContextChips } from "@/components/composer/composer-context-chips";
import { COMPOSER_TEXTAREA_CLASS, ComposerFrame } from "@/components/composer/composer-frame";
import { ComposerPopover } from "@/components/composer/composer-popover";
import { ModelMenu } from "@/components/composer/model-menu";
import { ProjectPicker } from "@/components/composer/project-picker";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { ArrowUp, Mic, Paperclip, Square } from "@/components/ui/icons";
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
          <ComposerStatusLine
            status={controller.state.composerStatus}
            tone={controller.state.composerStatusTone}
          />
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
        skill={controller.state.selectedSkill}
        tool={null}
      />
      <div className="flex items-start gap-2">
        <label className="sr-only" htmlFor="prompt">
          Message Cheatcode
        </label>
        <textarea
          className={cn(COMPOSER_TEXTAREA_CLASS, controller.state.selectedSkill ? "pt-2" : "pt-4")}
          id="prompt"
          maxLength={USER_MESSAGE_MAX_CHARACTERS}
          onChange={controller.triggers.onTextareaChange}
          onClick={selectionHandler}
          onKeyDown={controller.actions.handleKeyDown}
          onKeyUp={selectionHandler}
          onSelect={selectionHandler}
          placeholder="Reply, refine, or take the wheel"
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
          variant="thread"
        />
        {controller.state.computerOpen ? null : (
          <VoiceInputButton
            isDisabled={controller.state.isRunning}
            voiceInput={controller.voiceInput}
          />
        )}
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
        aria-label="Upload files"
        accept={PROMPT_ATTACHMENT_ACCEPT}
        className="sr-only"
        multiple
        onChange={controller.attachments.onFileChange}
        ref={controller.attachments.inputRef}
        tabIndex={-1}
        type="file"
      />
      <CheatcodeTooltip label="Upload file">
        <button
          aria-label="Upload file"
          className="flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-background hover:text-foreground"
          onClick={() => controller.attachments.inputRef.current?.click()}
          type="button"
        >
          <Paperclip aria-hidden="true" className="h-4 w-4" />
        </button>
      </CheatcodeTooltip>
    </>
  );
}

function VoiceInputButton({
  isDisabled,
  voiceInput,
}: {
  isDisabled: boolean;
  voiceInput: VoiceInputState;
}) {
  const disabled = !voiceInput.isSupported || isDisabled;
  return (
    <CheatcodeTooltip
      disabled={!voiceInput.isSupported}
      label={voiceInput.isListening ? "Stop voice input" : "Voice input"}
    >
      <button
        aria-label={voiceInput.isListening ? "Stop voice input" : "Start voice input"}
        className={cn(
          "hidden h-7 w-7 items-center justify-center rounded-full transition-colors sm:flex",
          voiceInput.isListening
            ? "bg-red-500/10 text-red-600"
            : "text-fg-secondary hover:bg-background hover:text-foreground",
          disabled && "cursor-not-allowed opacity-45",
        )}
        disabled={disabled}
        onClick={voiceInput.toggle}
        type="button"
      >
        {voiceInput.isListening ? (
          <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
        ) : (
          <Mic aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
    </CheatcodeTooltip>
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

function ComposerStatusLine({ status, tone }: { status: null | string; tone: "error" | "ok" }) {
  if (!status) {
    return null;
  }
  return (
    <p
      aria-live="polite"
      className={cn(
        "px-2 pt-1 text-right text-[12px]",
        tone === "error" ? "text-red-600" : "text-fg-secondary",
      )}
    >
      {status}
    </p>
  );
}

function promptComposerFormClass(computerOpen: boolean): string {
  return cn(PROMPT_COMPOSER_FORM_BASE, computerOpen ? "pb-2" : "pb-3 md:pb-10");
}
