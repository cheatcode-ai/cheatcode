"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import {
  DollarSign,
  type LucideIcon,
  SlidersHorizontal,
  Sparkles,
  SquareAsterisk,
  User,
  Zap,
} from "@/components/ui/icons";
import { MenuBar } from "@/components/ui/menu-bar";
import { AgentsPanel } from "./agents-panel";
import { BillingPanel } from "./billing-panel";
import { IntegrationsPanel } from "./integrations-panel";
import { PersonalizationPanel } from "./personalization-panel";
import { ProviderKeysPanel } from "./provider-keys-panel";
import { SettingsHeading } from "./settings-heading";
import { ThemePreference } from "./theme-preference";

export type SettingsSectionId =
  | "account"
  | "integrations"
  | "personalization"
  | "agents"
  | "api-keys"
  | "billing";

type SettingsMenuItem = {
  gradient: string;
  href: string;
  icon: LucideIcon;
  iconColor: string;
  id: SettingsSectionId;
  label: string;
};

const SETTINGS_MENU_ITEMS = [
  {
    href: "/settings/account",
    icon: User,
    gradient:
      "radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(37,99,235,0.06) 50%, rgba(29,78,216,0) 100%)",
    iconColor: "text-blue-500",
    id: "account",
    label: "Account",
  },
  {
    href: "/settings/integrations",
    icon: Zap,
    gradient:
      "radial-gradient(circle, rgba(234,179,8,0.15) 0%, rgba(202,138,4,0.06) 50%, rgba(161,98,7,0) 100%)",
    iconColor: "text-yellow-500",
    id: "integrations",
    label: "Integrations",
  },
  {
    href: "/settings/personalization",
    icon: SlidersHorizontal,
    gradient:
      "radial-gradient(circle, rgba(236,72,153,0.15) 0%, rgba(219,39,119,0.06) 50%, rgba(190,24,93,0) 100%)",
    iconColor: "text-pink-500",
    id: "personalization",
    label: "Personalization",
  },
  {
    href: "/settings/agents",
    icon: Sparkles,
    gradient:
      "radial-gradient(circle, rgba(168,85,247,0.15) 0%, rgba(147,51,234,0.06) 50%, rgba(126,34,206,0) 100%)",
    iconColor: "text-purple-500",
    id: "agents",
    label: "Agents",
  },
  {
    href: "/settings/api-keys",
    icon: SquareAsterisk,
    gradient:
      "radial-gradient(circle, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.06) 50%, rgba(185,28,28,0) 100%)",
    iconColor: "text-red-500",
    id: "api-keys",
    label: "API Keys",
  },
  {
    href: "/settings/billing",
    icon: DollarSign,
    gradient:
      "radial-gradient(circle, rgba(16,185,129,0.15) 0%, rgba(5,150,105,0.06) 50%, rgba(4,120,87,0) 100%)",
    iconColor: "text-emerald-500",
    id: "billing",
    label: "Billing",
  },
] as const satisfies readonly SettingsMenuItem[];

export function SettingsPageClient({ activeSection }: { activeSection: SettingsSectionId }) {
  return (
    <section className="chat-scrollbar -mt-6 min-w-0 flex-1 overflow-y-auto pt-16 text-zinc-200">
      <div className="mx-auto w-full max-w-7xl px-6 py-12">
        <div className="mb-16 flex justify-center">
          <SettingsMenuBar activeSection={activeSection} />
        </div>
        <SettingsSection section={activeSection} />
      </div>
    </section>
  );
}

function SettingsMenuBar({ activeSection }: { activeSection: SettingsSectionId }) {
  const activeItem =
    SETTINGS_MENU_ITEMS.find((item) => item.id === activeSection)?.label ?? "Account";

  return (
    <div className="max-w-full overflow-x-auto">
      <MenuBar
        activeItem={activeItem}
        aria-label="Settings sections"
        items={[...SETTINGS_MENU_ITEMS]}
      />
    </div>
  );
}

function SettingsSection({ section }: { section: SettingsSectionId }) {
  if (section === "integrations") {
    return <IntegrationsPanel />;
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
  return <AccountPanel />;
}

function AccountPanel() {
  const { user } = useUser();
  const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? "Signed in";
  const displayName = user?.fullName ?? user?.username ?? "Cheatcode account";

  return (
    <div className="flex flex-col items-center text-zinc-200">
      <SettingsHeading
        description="Manage the account connected to this Cheatcode workspace."
        title="Account"
      />
      <div className="w-full max-w-lg space-y-6">
        <section className="space-y-6 rounded-3xl border border-zinc-800/80 bg-[#111] p-8 text-center shadow-xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10 text-violet-400 ring-4 ring-violet-500/5">
            <User aria-hidden="true" className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-[0.24em]">
              Workspace
            </p>
            <h2 className="font-medium text-white">{displayName}</h2>
            <p className="font-mono text-sm text-zinc-500">{primaryEmail}</p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <UserButton />
            <a
              className="inline-flex h-10 items-center justify-center rounded-xl px-5 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              href="/projects"
            >
              Open workspace
            </a>
          </div>
        </section>
        <section className="space-y-4 rounded-3xl border border-zinc-800/80 bg-[#111] p-8 shadow-xl">
          <div className="space-y-1 text-center">
            <h2 className="font-medium text-white">Appearance</h2>
            <p className="text-sm text-zinc-500">Theme is stored on this device.</p>
          </div>
          <ThemePreference />
        </section>
      </div>
    </div>
  );
}
