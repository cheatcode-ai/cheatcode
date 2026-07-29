import { ModelsPanel } from "@/components/settings/models-panel";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";

export default function ModelsPage() {
  return (
    <SettingsPageShell width="narrow">
      <ModelsPanel />
    </SettingsPageShell>
  );
}
