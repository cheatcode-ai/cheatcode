"use client";

import type { ChangeEvent, KeyboardEvent, SyntheticEvent } from "react";
import { useState } from "react";
import type { ConsoleLine } from "@/lib/preview/console";
import type { ConsoleTerminalEntry } from "@/lib/preview/console-terminal.types";
import { promptText, severityClass, terminalOutput } from "@/lib/preview/console-terminal-format";
import { cn } from "@/lib/ui/cn";

interface ConsoleTerminalPaneModel {
  command: string;
  entries: ConsoleTerminalEntry[];
  isDisabled: boolean;
  isNoProcess: boolean;
  isReady: boolean;
  isTruncated: boolean;
  lines: ConsoleLine[];
  pendingCommand: string | null;
  terminalCwd: string;
  terminalDisplayWorkspace: string;
  terminalHost: string;
}

interface ConsoleTerminalPaneProps {
  model: ConsoleTerminalPaneModel;
  onCommandChange: (command: string) => void;
  onSubmitCommand: () => void;
}

export function ConsoleTerminalPane({
  model,
  onCommandChange,
  onSubmitCommand,
}: ConsoleTerminalPaneProps) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-bg-secondary">
      <div className="chat-scrollbar h-full overflow-y-auto p-3 font-mono text-[13px] text-foreground leading-5">
        <TerminalTranscript model={model} />
        <TerminalCommandLine
          command={model.command}
          disabled={model.isDisabled}
          isReady={model.isReady}
          onCommandChange={onCommandChange}
          onSubmitCommand={onSubmitCommand}
          prompt={terminalPrompt(model)}
        />
      </div>
    </div>
  );
}

function TerminalTranscript({ model }: { model: ConsoleTerminalPaneModel }) {
  return (
    <>
      {model.isTruncated ? (
        <div className="mb-1 text-placeholder">earlier output truncated</div>
      ) : null}
      {model.isNoProcess && model.lines.length === 0 && model.entries.length === 0 ? (
        <div className="h-2" aria-hidden="true" />
      ) : null}
      {model.lines.map((line) => (
        <pre
          className={cn("whitespace-pre-wrap break-words", severityClass(line.severity))}
          data-severity={line.severity}
          key={line.id}
        >
          {line.text}
        </pre>
      ))}
      {model.entries.map((entry) => (
        <TerminalEntryView entry={entry} key={entry.id} model={model} />
      ))}
      {model.pendingCommand ? (
        <PendingTerminalCommand command={model.pendingCommand} prompt={terminalPrompt(model)} />
      ) : null}
    </>
  );
}

function TerminalEntryView({
  entry,
  model,
}: {
  entry: ConsoleTerminalEntry;
  model: ConsoleTerminalPaneModel;
}) {
  const output = terminalOutput(entry.result);
  const prompt = promptText(entry.cwd, model.terminalHost, model.terminalDisplayWorkspace);
  return (
    <div>
      <pre className="whitespace-pre-wrap break-words">
        {prompt} {entry.command}
      </pre>
      {output.length > 0 ? (
        <pre
          className={cn(
            "whitespace-pre-wrap break-words",
            entry.result.success ? "text-fg-tertiary" : "text-danger-fg",
          )}
        >
          {output}
        </pre>
      ) : null}
    </div>
  );
}

function PendingTerminalCommand({ command, prompt }: { command: string; prompt: string }) {
  return (
    <div className="text-placeholder">
      <pre className="whitespace-pre-wrap break-words">
        {prompt} {command}
      </pre>
    </div>
  );
}

interface TerminalCommandLineProps {
  command: string;
  disabled: boolean;
  isReady: boolean;
  onCommandChange: (command: string) => void;
  onSubmitCommand: () => void;
  prompt: string;
}

function TerminalCommandLine({
  command,
  disabled,
  isReady,
  onCommandChange,
  onSubmitCommand,
  prompt,
}: TerminalCommandLineProps) {
  return (
    <div className="flex min-w-0 items-center">
      <span className="shrink-0 whitespace-pre">{prompt}</span>
      {isReady ? (
        <TerminalEditableCommand
          command={command}
          disabled={disabled}
          onCommandChange={onCommandChange}
          onSubmitCommand={onSubmitCommand}
        />
      ) : (
        <span className="pl-1 text-placeholder">Sandbox not ready</span>
      )}
    </div>
  );
}

function TerminalEditableCommand({
  command,
  disabled,
  onCommandChange,
  onSubmitCommand,
}: Omit<TerminalCommandLineProps, "isReady" | "prompt">) {
  const cursor = useTerminalCursor(command, onCommandChange, onSubmitCommand);
  return (
    <div className="relative ml-1 flex min-h-[18px] min-w-0 flex-1 cursor-text items-center">
      <span aria-hidden="true" className="whitespace-pre-wrap break-words">
        {cursor.before}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "ml-px inline-block h-[15px] w-2 translate-y-px bg-foreground",
          disabled && "opacity-25",
        )}
      />
      <span aria-hidden="true" className="whitespace-pre-wrap break-words">
        {cursor.after}
      </span>
      <input
        aria-label="Terminal input"
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none disabled:cursor-not-allowed"
        disabled={disabled}
        onChange={cursor.onChange}
        onClick={cursor.onSelect}
        onKeyDown={cursor.onKeyDown}
        onSelect={cursor.onSelect}
        spellCheck={false}
        value={command}
      />
    </div>
  );
}

function useTerminalCursor(
  command: string,
  onCommandChange: (command: string) => void,
  onSubmitCommand: () => void,
) {
  // `null` means the browser-managed initial caret at the end. Once the user
  // moves it, state records that independent interaction.
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  const clampedCursorIndex = Math.min(cursorIndex ?? command.length, command.length);
  const onSelect = (event: SyntheticEvent<HTMLInputElement>) => {
    setCursorIndex(event.currentTarget.selectionStart ?? command.length);
  };
  return {
    after: command.slice(clampedCursorIndex),
    before: command.slice(0, clampedCursorIndex),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      onCommandChange(event.target.value);
      setCursorIndex(event.target.selectionStart ?? event.target.value.length);
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onSubmitCommand();
      }
    },
    onSelect,
  };
}

function terminalPrompt(model: ConsoleTerminalPaneModel): string {
  return promptText(model.terminalCwd, model.terminalHost, model.terminalDisplayWorkspace);
}
