import { PersonalizationPanel } from "@/components/settings/personalization-panel";

export default function PersonalizationPage() {
  return (
    <section className="chat-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto bg-background px-2.5 pt-6 pb-16 text-foreground sm:px-6 md:pt-10 lg:px-10">
      <div className="mx-auto w-full max-w-[740px]">
        <PersonalizationPanel />
      </div>
    </section>
  );
}
