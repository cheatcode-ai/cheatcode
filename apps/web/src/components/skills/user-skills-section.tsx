"use client";

import type { UserSkill } from "@cheatcode/types";
import { BookOpen, Loader2, MoreVertical, Trash2 } from "@cheatcode/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { deleteUserSkill, listUserSkills, USER_SKILLS_QUERY } from "@/lib/api/skills";

export function useUserSkillsCatalog(getToken: () => Promise<null | string>) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryFn: ({ signal }) => listUserSkills(getToken, signal),
    queryKey: USER_SKILLS_QUERY,
    staleTime: 30_000,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUserSkill(getToken, id),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not delete that skill"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USER_SKILLS_QUERY });
      toast.success("Skill deleted");
    },
  });
  const [selectedSkill, setSelectedSkill] = useState<UserSkill | null>(null);
  return {
    closeSkill: () => setSelectedSkill(null),
    deleteMutation,
    openSkill: setSelectedSkill,
    query,
    selectedSkill,
    skills: query.data ?? [],
  };
}

export type UserSkillsCatalog = ReturnType<typeof useUserSkillsCatalog>;

export function UserSkillsError({ controller }: { controller: UserSkillsCatalog }) {
  return (
    <section className="mt-7 flex min-h-40 items-center justify-center rounded-[24px] bg-bg-secondary p-5">
      <RecoveryCard
        action={{
          isPending: controller.query.isFetching,
          label: "Reload your skills",
          onClick: () => void controller.query.refetch(),
          pendingLabel: "Loading your skills…",
        }}
        description="Your saved skills couldn't be reached. Try loading them again."
        icon={BookOpen}
        size="compact"
        title="Your skills couldn't load"
      />
    </section>
  );
}

export function UserSkillCard({
  deleteMutation,
  onOpen,
  skill,
}: {
  deleteMutation: UserSkillsCatalog["deleteMutation"];
  onOpen: (skill: UserSkill) => void;
  skill: UserSkill;
}) {
  const menu = useUserSkillMenu();
  const isDeleting = deleteMutation.isPending && deleteMutation.variables === skill.id;
  const openCard = () => onOpen(skill);
  const deleteSkill = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    menu.close();
    deleteMutation.mutate(skill.id);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: Bud's card pattern needs a nested overflow button, which a native button cannot contain.
    <div
      className="relative cursor-pointer rounded-[23px] border-2 border-secondary bg-background p-0.5 text-left transition-colors hover:border-border"
      onClick={openCard}
      onKeyDown={(event) => activateCardFromKeyboard(event, openCard)}
      ref={menu.ref}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between p-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center text-primary">
            <CheatcodeMark aria-hidden="true" className="size-4" />
          </span>
          <p className="truncate font-medium text-foreground text-sm">{skill.name}</p>
        </div>
        <button
          aria-expanded={menu.isOpen}
          aria-label={`More actions for ${skill.name}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-xl text-placeholder transition-colors duration-200 hover:bg-secondary hover:text-foreground active:scale-[.99]"
          onClick={(event) => {
            event.stopPropagation();
            menu.toggle();
          }}
          type="button"
        >
          <MoreVertical aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
        </button>
      </div>
      <div className="flex h-10 items-center justify-between gap-3 rounded-full bg-secondary px-4">
        <p className="line-clamp-1 min-w-0 text-placeholder text-xs">{skill.description}</p>
      </div>
      {menu.isOpen ? (
        <div
          aria-label={`More actions for ${skill.name}`}
          className="absolute top-10 right-2 z-30 w-44 rounded-lg border border-border bg-background p-1 shadow-md"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="menu"
        >
          <button
            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-red-600 text-sm outline-none transition-colors hover:bg-red-600/10 disabled:opacity-50"
            disabled={isDeleting}
            onClick={deleteSkill}
            role="menuitem"
            type="button"
          >
            {isDeleting ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="size-4" />
            )}
            Delete skill
          </button>
        </div>
      ) : null}
    </div>
  );
}

function useUserSkillMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isOpen]);
  return {
    close: () => setIsOpen(false),
    isOpen,
    ref,
    toggle: () => setIsOpen((value) => !value),
  };
}

function activateCardFromKeyboard(event: KeyboardEvent<HTMLDivElement>, openCard: () => void) {
  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  openCard();
}
