"use client";

import { useAddMenuController } from "@/components/composer/add-menu-controller";
import { RepoImportControl } from "@/components/composer/repo-import-control";
import { CheatcodeTooltip } from "@/components/ui/cheatcode-tooltip";
import { Paperclip, Plus } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * The composer "+" menu: local file upload (delegates to the existing hidden file
 * input via `onUploadClick`) and one-shot public GitHub import. The repo URL is
 * validated client-side with the shared `GitHubRepoUrlSchema`; the gateway and DO
 * re-validate at their own trust boundaries.
 */
export function AddMenu({
  allowRepoImport = true,
  onRepoAttach,
  onUploadClick,
}: {
  allowRepoImport?: boolean | undefined;
  onRepoAttach: (url: string) => void;
  onUploadClick: () => void;
}) {
  const controller = useAddMenuController();
  const attachRepo = (url: string) => {
    onRepoAttach(url);
    controller.actions.close();
  };
  const uploadFile = () => {
    onUploadClick();
    controller.actions.close();
  };
  return (
    <div className="relative" ref={controller.meta.menuRef}>
      <AddMenuTrigger controller={controller} />
      {controller.state.isOpen ? (
        <AddMenuPopup
          allowRepoImport={allowRepoImport}
          onRepoAttach={attachRepo}
          onUpload={uploadFile}
        />
      ) : null}
    </div>
  );
}

type AddMenuController = ReturnType<typeof useAddMenuController>;

function AddMenuTrigger({ controller }: { controller: AddMenuController }) {
  return (
    <CheatcodeTooltip label="Add to prompt">
      <button
        aria-expanded={controller.state.isOpen}
        aria-label="Add to prompt"
        className={cn(
          "flex size-7 items-center justify-center rounded-full outline-none",
          "bg-background text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground focus-visible:bg-primary/10 focus-visible:text-foreground",
        )}
        onClick={controller.actions.toggle}
        ref={controller.meta.triggerRef}
        type="button"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </button>
    </CheatcodeTooltip>
  );
}

function AddMenuPopup({
  allowRepoImport,
  onRepoAttach,
  onUpload,
}: {
  allowRepoImport: boolean;
  onRepoAttach: (url: string) => void;
  onUpload: () => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 flex w-72 flex-col gap-1 rounded-2xl border border-border bg-background p-1 shadow-[0_18px_60px_rgba(0,0,0,0.12)]">
      <button
        className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[13px] text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground"
        onClick={onUpload}
        type="button"
      >
        <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
        Upload file
      </button>
      <RepoImportControl allowed={allowRepoImport} onAttach={onRepoAttach} />
    </div>
  );
}
