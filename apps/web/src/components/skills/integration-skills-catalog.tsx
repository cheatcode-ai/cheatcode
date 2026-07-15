"use client";

import { IntegrationSkillDrawer } from "@/components/skills/integration-skill-drawer";
import { CategoryTabs, SkillsHeader } from "@/components/skills/integration-skills-controls";
import { ToolsGrid } from "@/components/skills/integration-skills-grid";
import { useIntegrationSkillsCatalog } from "@/components/skills/use-integration-skills-catalog";
import { UserSkillsSection } from "@/components/skills/user-skills-section";

export function IntegrationSkillsCatalog() {
  const catalog = useIntegrationSkillsCatalog();
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
      <UserSkillsSection getToken={catalog.getToken} />
      <ToolsGrid
        handlers={catalog.handlers}
        isError={catalog.query.isError}
        isPending={catalog.query.isPending}
        isRetrying={catalog.query.isFetching}
        onOpen={catalog.openToolkit}
        onRetry={() => void catalog.query.refetch()}
        toolkits={catalog.filteredToolkits}
      />
      <IntegrationSkillDrawer
        handlers={catalog.handlers}
        onClose={catalog.closeToolkit}
        open={catalog.isDrawerOpen}
        toolkit={catalog.displayedToolkit}
      />
    </div>
  );
}
