"use client";

import { AccountPanel } from "./account-panel";
import { AgentsPanel } from "./agents-panel";
import { BillingPanel } from "./billing-panel";
import { PersonalizationPanel } from "./personalization-panel";
import { ProviderKeysPanel } from "./provider-keys-panel";

export type SettingsSectionId = "account" | "personalization" | "agents" | "api-keys" | "billing";

export function SettingsPageClient({ activeSection }: { activeSection: SettingsSectionId }) {
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto bg-white px-6 pt-6 pb-16 text-[#1b1b1b]">
      <div className="mx-auto w-full max-w-[740px]">
        <SettingsSection section={activeSection} />
      </div>
    </section>
  );
}

function SettingsSection({ section }: { section: SettingsSectionId }) {
  if (section === "account") {
    return <AccountPanel />;
  }
  if (section === "personalization") {
    return <PersonalizationPanel />;
  }
  if (section === "agents") {
    return <AgentsPanel />;
  }
  if (section === "api-keys") {
    return <ProviderKeysPanel />;
  }
  if (section === "billing") {
    return <BillingPanel />;
  }
  return <PersonalizationPanel />;
}
