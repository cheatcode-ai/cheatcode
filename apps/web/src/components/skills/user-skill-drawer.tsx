"use client";

import type { UserSkill } from "@cheatcode/types";
import { Loader2, ModalShell, Trash2 } from "@cheatcode/ui";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";

export function UserSkillDrawer({
  isDeleting,
  onClose,
  onDelete,
  open,
  skill,
}: {
  isDeleting: boolean;
  onClose: () => void;
  onDelete: (skill: UserSkill) => void;
  open: boolean;
  skill: UserSkill | null;
}) {
  return (
    <ModalShell
      className="fixed top-3 right-3 bottom-3 left-auto m-0 flex h-auto w-[460px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border-0 bg-secondary shadow-none ring-2 ring-border ring-offset-2 ring-offset-background backdrop:bg-background/70 backdrop:backdrop-blur-[3px]"
      labelledBy="user-skill-drawer-title"
      onClose={onClose}
      open={open}
    >
      {skill ? (
        <div className="relative flex-1 overflow-hidden">
          <header className="sticky top-0 z-10 flex h-[57px] items-center gap-1.5 border-border border-b bg-secondary px-4 py-3">
            <span className="flex size-8 items-center justify-center text-primary">
              <CheatcodeMark aria-hidden="true" className="size-4" />
            </span>
            <h2
              className="min-w-0 flex-1 truncate font-semibold text-base text-foreground"
              id="user-skill-drawer-title"
            >
              {skill.name}
            </h2>
          </header>
          <div className="p-6 pt-6">
            <div className="flex flex-col gap-6">
              <p className="text-placeholder text-sm leading-5">{skill.description}</p>
              <div>
                <button
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-red-600/10 px-3 font-medium text-red-600 text-sm shadow-xs transition-colors duration-200 hover:bg-red-600/20 active:scale-[.99] disabled:opacity-50"
                  disabled={isDeleting}
                  onClick={() => onDelete(skill)}
                  type="button"
                >
                  {isDeleting ? (
                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
                  )}
                  Delete skill
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}
