"use client";

import { useAuth } from "@clerk/nextjs";
import { ConsoleStripHeader } from "@/components/preview/console-strip-header";
import { ConsoleTerminalPane } from "@/components/preview/console-terminal-pane";
import { useConsoleTerminal } from "@/lib/preview/use-console-terminal";
import { usePreviewConsole } from "@/lib/preview/use-preview-console";
import { useAppStore } from "@/lib/store/app-store";
import { emitConsoleStripOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";

interface ConsoleStripProps {
  sandboxAvailable: boolean;
  threadId: string | null;
}

/**
 * Collapsed-by-default terminal surface. Preview console polling remains tied
 * to visibility, while authenticated terminal state lives in its controller.
 */
export function ConsoleStrip({ sandboxAvailable, threadId }: ConsoleStripProps) {
  const controller = useConsoleStripController(sandboxAvailable, threadId);
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col bg-background transition-[height] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        controller.isOpen ? "h-[200px]" : "h-[34px]",
      )}
    >
      <ConsoleStripHeader
        activeConsoleId={controller.terminal.activeConsole?.id}
        isOpen={controller.isOpen}
        onAddTab={controller.terminal.addConsoleTab}
        onCloseTab={controller.terminal.closeConsoleTab}
        onSelectTab={controller.terminal.selectConsoleTab}
        onToggle={controller.toggle}
        tabs={controller.terminal.consoleTabs}
      />
      {controller.isOpen ? <ActiveConsolePane controller={controller} /> : null}
    </div>
  );
}

function ActiveConsolePane({
  controller,
}: {
  controller: ReturnType<typeof useConsoleStripController>;
}) {
  const activeConsole = controller.terminal.activeConsole;
  if (!activeConsole) {
    return null;
  }
  const isPrimaryConsole = activeConsole.ordinal === 1;
  return (
    <ConsoleTerminalPane
      model={{
        command: activeConsole.command,
        entries: activeConsole.entries,
        isDisabled: controller.terminal.isDisabled,
        isNoProcess: isPrimaryConsole && controller.consoleProcess === null,
        isReady: controller.terminal.isReady,
        isTruncated: isPrimaryConsole && controller.consoleTruncated,
        lines: isPrimaryConsole ? controller.consoleLines : [],
        pendingCommand: controller.terminal.pendingCommand,
        terminalCwd: activeConsole.cwd,
        terminalDisplayWorkspace: controller.terminal.displayWorkspacePath,
        terminalHost: controller.terminal.terminalHost,
      }}
      onCommandChange={controller.terminal.updateActiveCommand}
      onSubmitCommand={controller.terminal.submitActiveCommand}
    />
  );
}

function useConsoleStripController(sandboxAvailable: boolean, threadId: string | null) {
  const { getToken } = useAuth();
  const consoleLines = useAppStore((state) => state.consoleLines);
  const consoleProcess = useAppStore((state) => state.consoleProcess);
  const isOpen = useAppStore((state) => state.consoleStripOpen);
  const consoleTruncated = useAppStore((state) => state.consoleTruncated);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const setOpen = useAppStore((state) => state.setConsoleStripOpen);
  const isReady = sandboxAvailable || sandboxStatus === "ready";
  const disclosure = createConsoleStripDisclosure(isOpen, setOpen, getToken);
  usePreviewConsole(threadId, isOpen && isReady);
  const terminal = useConsoleTerminal({
    getToken,
    isReady,
    onOpen: disclosure.open,
    previewUrl,
    threadId,
  });
  return { consoleLines, consoleProcess, consoleTruncated, isOpen, terminal, ...disclosure };
}

function createConsoleStripDisclosure(
  isOpen: boolean,
  setOpen: (isOpen: boolean) => void,
  getToken: () => Promise<null | string>,
) {
  const open = () => {
    if (!isOpen) {
      setOpen(true);
      void emitConsoleStripOpened(getToken).catch(() => undefined);
    }
  };
  return {
    open,
    toggle: () => {
      if (isOpen) {
        setOpen(false);
      } else {
        open();
      }
    },
  };
}
