import { MessageCircle } from "@cheatcode/ui";
import { CheatcodeLoader } from "@/components/ui/cheatcode-loader";
import { RecoveryCard } from "@/components/ui/recovery-card";

export function WorkspaceLoadingState() {
  return (
    <CheatcodeLoader
      className="flex min-h-[calc(100vh-16px)] min-w-0 flex-1 items-center justify-center bg-background px-6"
      label="Opening workspace"
    />
  );
}

export function ChatUnavailableState({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-background px-6">
      <RecoveryCard
        action={{
          isPending: isRetrying,
          label: "Try again",
          onClick: onRetry,
          pendingLabel: "Reloading…",
        }}
        announce="assertive"
        description="Cheatcode couldn't load this chat. It may be unavailable, or the connection may have failed."
        headingLevel={1}
        icon={MessageCircle}
        title="Chat isn't available"
      />
    </section>
  );
}
