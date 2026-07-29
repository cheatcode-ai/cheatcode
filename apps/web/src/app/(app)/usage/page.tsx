import { SettingsPageShell } from "@/components/settings/settings-page-shell";
import { UsagePanel } from "@/components/settings/usage-panel";

export default function UsagePage() {
  return (
    <SettingsPageShell width="wide">
      <UsagePanel />
    </SettingsPageShell>
  );
}
