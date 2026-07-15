import { BillingPanel } from "@/components/settings/billing-panel";

export default function BillingPage() {
  return (
    <section className="chat-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto bg-background px-2.5 pt-6 pb-16 text-foreground md:pt-10">
      <div className="mx-auto w-full max-w-5xl">
        <BillingPanel />
      </div>
    </section>
  );
}
