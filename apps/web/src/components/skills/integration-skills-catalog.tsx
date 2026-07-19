"use client";

import { IntegrationSkillDrawer } from "@/components/skills/integration-skill-drawer";
import { CategoryTabs, SkillsHeader } from "@/components/skills/integration-skills-controls";
import { ToolsGrid } from "@/components/skills/integration-skills-grid";
import { useIntegrationSkillsCatalog } from "@/components/skills/use-integration-skills-catalog";
import { UserSkillDrawer } from "@/components/skills/user-skill-drawer";
import { UserSkillsError, useUserSkillsCatalog } from "@/components/skills/user-skills-section";

export function IntegrationSkillsCatalog() {
  const catalog = useIntegrationSkillsCatalog();
  const userSkills = useUserSkillsCatalog(catalog.getToken);
  const visibleUserSkills = filterUserSkills(userSkills.skills, catalog.category, catalog.search);
  const selectedUserSkill = userSkills.selectedSkill;
  const deleteSelectedUserSkill = () => {
    if (!selectedUserSkill) return;
    userSkills.deleteMutation.mutate(selectedUserSkill.id, {
      onSuccess: userSkills.closeSkill,
    });
  };
  return (
    <div>
      <div className="flex flex-col gap-6 md:gap-8">
        <SkillsHeader onSearch={catalog.setSearch} search={catalog.search} />
        <CategoryTabs
          categories={catalog.categories}
          onSelect={catalog.setCategory}
          selected={catalog.category}
        />
      </div>
      {userSkills.query.isError ? <UserSkillsError controller={userSkills} /> : null}
      <ToolsGrid
        handlers={catalog.handlers}
        isError={catalog.query.isError}
        isPending={catalog.query.isPending}
        isRetrying={catalog.query.isFetching}
        onOpen={catalog.openToolkit}
        onRetry={() => void catalog.query.refetch()}
        toolkits={catalog.filteredToolkits}
        userSkills={visibleUserSkills}
        userSkillsCatalog={userSkills}
      />
      <IntegrationSkillDrawer
        handlers={catalog.handlers}
        onClose={catalog.closeToolkit}
        open={catalog.isDrawerOpen}
        toolkit={catalog.displayedToolkit}
      />
      <UserSkillDrawer
        isDeleting={
          userSkills.deleteMutation.isPending &&
          userSkills.deleteMutation.variables === selectedUserSkill?.id
        }
        onClose={userSkills.closeSkill}
        onDelete={deleteSelectedUserSkill}
        open={selectedUserSkill !== null}
        skill={selectedUserSkill}
      />
    </div>
  );
}

function filterUserSkills(
  skills: ReturnType<typeof useUserSkillsCatalog>["skills"],
  category: string,
  search: string,
) {
  if (category !== "all") return [];
  const needle = search.trim().toLowerCase();
  if (!needle) return skills;
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle),
  );
}
