import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { MessageCircle, Plus } from "@/components/ui/icons";
import { RecoveryCard } from "@/components/ui/recovery-card";

export function WorkspaceLoadingState() {
  return (
    <CheatcodeLoader
      className="flex min-h-[calc(100vh-16px)] min-w-0 flex-1 items-center justify-center bg-background px-6"
      label="Opening workspace"
    />
  );
}

export function ChatUnavailableState() {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-background px-6">
      <RecoveryCard
        action={{ href: "/", icon: Plus, label: "Start a new chat" }}
        announce="off"
        description="This chat may have been deleted, or its link is no longer valid."
        headingLevel={1}
        icon={MessageCircle}
        title="Chat isn't available"
      />
    </section>
  );
}
