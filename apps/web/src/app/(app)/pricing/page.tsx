import { PricingPanel } from "@/components/settings/pricing-panel";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";

export default function PricingPage() {
  return (
    <SettingsPageShell width="wide">
      <PricingPanel />
    </SettingsPageShell>
  );
}
