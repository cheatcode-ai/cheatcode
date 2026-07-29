import { PersonalizationPanel } from "@/components/settings/personalization-panel";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";

export default function PersonalizationPage() {
  return (
    <SettingsPageShell width="narrow">
      <PersonalizationPanel />
    </SettingsPageShell>
  );
}
