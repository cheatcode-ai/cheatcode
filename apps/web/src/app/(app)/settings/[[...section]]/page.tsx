import { redirect } from "next/navigation";
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
  ["personalization"],
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
  if (resolvedParams.section?.[0] === "integrations") {
    redirect("/tools");
  }
  return <SettingsPageClient activeSection={activeSectionFromSegments(resolvedParams.section)} />;
}

function SettingsPageFallback() {
  return (
    <section className="chat-scrollbar min-w-0 flex-1 overflow-y-auto bg-white px-6 pt-6 text-[#1b1b1b]">
      <div className="mx-auto w-full max-w-[740px]">
        <div className="flex flex-col gap-6">
          <div className="h-7 w-32 rounded-md bg-thread-skeleton" />
          <div className="h-4 w-80 max-w-full rounded-md bg-thread-skeleton" />
        </div>
      </div>
    </section>
  );
}

function activeSectionFromSegments(segments: string[] | undefined): SettingsSectionId {
  const section = segments?.[0];

  if (section === "account") {
    return "account";
  }
  if (section === "personalization") {
    return "personalization";
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
  return "personalization";
}
