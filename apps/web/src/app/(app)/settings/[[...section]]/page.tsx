import { Suspense } from "react";
import {
  SettingsPageClient,
  type SettingsSectionId,
} from "@/components/settings/settings-page-client";

type SettingsPageProps = {
  params: Promise<{ section?: string[] }>;
};

const SETTINGS_STATIC_SECTIONS = [
  [],
  ["account"],
  ["integrations"],
  ["agents"],
  ["api-keys"],
  ["byok"],
  ["providers"],
  ["billing"],
] as const;

export function generateStaticParams(): { section: string[] }[] {
  return SETTINGS_STATIC_SECTIONS.map((section) => ({ section: [...section] }));
}

export default function SettingsPage({ params }: SettingsPageProps) {
  return (
    <Suspense fallback={<SettingsPageFallback />}>
      <ResolvedSettingsPage params={params} />
    </Suspense>
  );
}

async function ResolvedSettingsPage({ params }: SettingsPageProps) {
  const resolvedParams = await params;
  return <SettingsPageClient activeSection={activeSectionFromSegments(resolvedParams.section)} />;
}

function SettingsPageFallback() {
  return (
    <section className="chat-scrollbar -mt-6 min-w-0 flex-1 overflow-y-auto pt-16 text-zinc-200">
      <div className="mx-auto w-full max-w-7xl px-6 py-12">
        <div className="mb-16 flex justify-center">
          <div className="h-14 w-full max-w-2xl rounded-full border border-zinc-800/80 bg-[#111]" />
        </div>
        <div className="mx-auto flex max-w-xl flex-col items-center gap-6 text-center">
          <div className="h-7 w-32 rounded-md bg-thread-skeleton" />
          <div className="h-4 w-80 max-w-full rounded-md bg-thread-skeleton" />
        </div>
      </div>
    </section>
  );
}

function activeSectionFromSegments(segments: string[] | undefined): SettingsSectionId {
  const section = segments?.[0];

  if (section === "integrations") {
    return "integrations";
  }
  if (section === "agents") {
    return "agents";
  }
  if (section === "api-keys" || section === "byok" || section === "providers") {
    return "api-keys";
  }
  if (section === "billing") {
    return "billing";
  }
  return "account";
}
