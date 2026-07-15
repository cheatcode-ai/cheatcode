"use client";

import type { UserSkill } from "@cheatcode/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PromptLaunchButton } from "@/components/navigation/prompt-launch-button";
import { CheatcodeMark } from "@/components/ui/cheatcode-mark";
import { BookOpen, Trash2 } from "@/components/ui/icons";
import { RecoveryCard } from "@/components/ui/recovery-card";
import { deleteUserSkill, listUserSkills, USER_SKILLS_QUERY } from "@/lib/api/skills";
import { emitSkillUseClicked } from "@/lib/telemetry/user-events";

export function UserSkillsSection({ getToken }: { getToken: () => Promise<null | string> }) {
  const controller = useUserSkills(getToken);
  if (controller.query.isError) {
    return <UserSkillsError controller={controller} />;
  }
  if (controller.skills.length === 0) {
    return null;
  }
  return (
    <UserSkillsList
      deleteMutation={controller.deleteMutation}
      getToken={getToken}
      skills={controller.skills}
    />
  );
}

function useUserSkills(getToken: () => Promise<null | string>) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryFn: () => listUserSkills(getToken),
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
  return { deleteMutation, query, skills: query.data ?? [] };
}

function UserSkillsError({ controller }: { controller: ReturnType<typeof useUserSkills> }) {
  return (
    <section className="mt-7 flex min-h-52 items-center justify-center rounded-[24px] bg-bg-secondary p-5">
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

function UserSkillsList({
  deleteMutation,
  getToken,
  skills,
}: {
  deleteMutation: ReturnType<typeof useUserSkills>["deleteMutation"];
  getToken: () => Promise<null | string>;
  skills: UserSkill[];
}) {
  return (
    <section className="mt-7 rounded-[24px] border-2 border-border bg-background p-0.5">
      <div className="rounded-[20px] bg-secondary p-3.5">
        <h2 className="px-1 font-semibold text-[15px] text-foreground">Your skills</h2>
        <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {skills.map((skill) => (
            <UserSkillRow
              deleteMutation={deleteMutation}
              getToken={getToken}
              key={skill.id}
              skill={skill}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function UserSkillRow({
  deleteMutation,
  getToken,
  skill,
}: {
  deleteMutation: ReturnType<typeof useUserSkills>["deleteMutation"];
  getToken: () => Promise<null | string>;
  skill: UserSkill;
}) {
  return (
    <li className="group flex items-center gap-3 rounded-[17px] bg-background p-3 shadow-[inset_0_0_0_1px_var(--border-subtle)] transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-[inset_0_0_0_1px_var(--border-tree),0_4px_14px_rgba(0,0,0,.04)]">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-[14px] bg-secondary text-[#86641d]">
        <CheatcodeMark aria-hidden="true" className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-[14px] text-foreground">{skill.name}</span>
        <span className="truncate text-[12px] text-placeholder">{skill.description}</span>
      </span>
      <PromptLaunchButton
        className="shrink-0 font-medium text-[13px] text-fg-secondary transition-colors hover:text-foreground"
        onLaunch={() => emitSkillUseClicked(getToken)}
        prompt={`/${skill.name} `}
      >
        Use
      </PromptLaunchButton>
      <button
        aria-label={`Delete ${skill.name}`}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-placeholder transition-colors hover:bg-secondary hover:text-red-600 disabled:opacity-45"
        disabled={deleteMutation.isPending && deleteMutation.variables === skill.id}
        onClick={() => deleteMutation.mutate(skill.id)}
        type="button"
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
