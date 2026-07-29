import { Suspense } from "react";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";
import { IntegrationSkillsCatalog } from "@/components/skills/integration-skills-catalog";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";

export default function SkillsPage() {
  return (
    <SettingsPageShell width="narrow">
      <Suspense fallback={<CheatcodeLoader className="min-h-72" label="Loading skills" />}>
        <IntegrationSkillsCatalog />
      </Suspense>
    </SettingsPageShell>
  );
}
