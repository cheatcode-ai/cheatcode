"use client";

import { Loader2, MoreVertical, Pencil, Trash2 } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { SidebarChat, useSidebarChats } from "@/components/shell/sidebar-data";
import {
  SidebarDeleteDialog,
  SidebarInlineRenameInput,
} from "@/components/shell/sidebar-item-controls";
import {
  SidebarInlineAction,
  SidebarInlineActions,
  useSidebarInlineMenu,
} from "@/components/shell/sidebar-list-controls";
import { SidebarListLoading } from "@/components/shell/sidebar-list-loading";
import { deleteThread, updateThread } from "@/lib/api/project-thread";
import { useChatTabsStore } from "@/lib/store/chat-tabs-store";
import { cn } from "@/lib/ui/cn";

export function ChatList({
  activeThreadId,
  chats,
}: {
  activeThreadId: string | null;
  chats: ReturnType<typeof useSidebarChats>;
}) {
  const actions = useChatActions(activeThreadId);
  if (chats.isLoading) return <SidebarListLoading label="Loading chats" />;
  if (chats.items.length === 0) {
    return <div className="px-2 py-2 text-[12px] text-placeholder">No chats yet</div>;
  }
  return (
    <>
      <ChatRows
        actions={actions}
        activeThreadId={activeThreadId}
        chats={chats.items.slice(0, 12)}
      />
      <SidebarDeleteDialog
        busy={actions.deleteMutation.isPending}
        itemName={actions.pendingDelete?.title || "New chat"}
        onCancel={() => actions.setPendingDelete(null)}
        onConfirm={actions.confirmDelete}
        open={actions.pendingDelete !== null}
      />
    </>
  );
}

function ChatRows({
  actions,
  activeThreadId,
  chats,
}: {
  actions: ReturnType<typeof useChatActions>;
  activeThreadId: string | null;
  chats: ReturnType<typeof useSidebarChats>["items"];
}) {
  return (
    <div className="space-y-0.5 py-1">
      {chats.map((chat) => (
        <ChatRow
          activeThreadId={activeThreadId}
          chat={{
            activeRunId: chat.activeRunId ?? null,
            id: chat.id,
            projectId: chat.projectId,
            title: chat.title,
          }}
          isDeleting={
            actions.deleteMutation.isPending && actions.deleteMutation.variables?.id === chat.id
          }
          isRenaming={
            actions.renameMutation.isPending &&
            actions.renameMutation.variables?.chat.id === chat.id
          }
          key={chat.id}
          onDelete={actions.setPendingDelete}
          onRename={(item, title) => actions.renameMutation.mutate({ chat: item, title })}
        />
      ))}
    </div>
  );
}

function useChatActions(activeThreadId: string | null) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const closeChatTab = useChatTabsStore((state) => state.closeChatTab);
  const openChatTab = useChatTabsStore((state) => state.openChatTab);
  const [pendingDelete, setPendingDelete] = useState<SidebarChat | null>(null);
  const deleteMutation = useChatDeleteMutation({
    activeThreadId,
    closeChatTab,
    getToken,
    queryClient,
    routerPush: (href) => router.push(href),
    setPendingDelete,
  });
  const renameMutation = useChatRenameMutation({ getToken, openChatTab, queryClient });
  return {
    confirmDelete: () => {
      if (pendingDelete) deleteMutation.mutate(pendingDelete);
    },
    deleteMutation,
    pendingDelete,
    renameMutation,
    setPendingDelete,
  };
}

function useChatDeleteMutation({
  activeThreadId,
  closeChatTab,
  getToken,
  queryClient,
  routerPush,
  setPendingDelete,
}: {
  activeThreadId: string | null;
  closeChatTab: (projectId: string, chatId: string) => void;
  getToken: () => Promise<null | string>;
  queryClient: QueryClient;
  routerPush: (href: string) => void;
  setPendingDelete: (chat: SidebarChat | null) => void;
}) {
  return useMutation({
    mutationFn: (chat: SidebarChat) => deleteThread(getToken, chat.id),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Chat delete failed"),
    onSettled: () => setPendingDelete(null),
    onSuccess: (_result, chat) => {
      toast.success("Chat deleted");
      if (chat.projectId) closeChatTab(chat.projectId, chat.id);
      invalidateChatQueries(queryClient);
      if (activeThreadId === chat.id) routerPush("/");
    },
  });
}

function useChatRenameMutation({
  getToken,
  openChatTab,
  queryClient,
}: {
  getToken: () => Promise<null | string>;
  openChatTab: (tab: { id: string; projectId: string; title: string }) => void;
  queryClient: QueryClient;
}) {
  return useMutation({
    mutationFn: ({ chat, title }: { chat: SidebarChat; title: string }) =>
      updateThread(getToken, chat.id, { title }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Chat rename failed"),
    onSuccess: (result, { chat }) => {
      toast.success(`Renamed to ${result.title ?? "New chat"}`);
      if (chat.projectId) {
        openChatTab({
          id: chat.id,
          projectId: chat.projectId,
          title: result.title?.trim() || "New chat",
        });
      }
      invalidateChatQueries(queryClient);
    },
  });
}

function invalidateChatQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
  void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
}

function ChatRow({
  activeThreadId,
  chat,
  isDeleting,
  isRenaming,
  onDelete,
  onRename,
}: {
  activeThreadId: string | null;
  chat: SidebarChat;
  isDeleting: boolean;
  isRenaming: boolean;
  onDelete: (chat: SidebarChat) => void;
  onRename: (chat: SidebarChat, title: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useSidebarInlineMenu(menuOpen, setMenuOpen);
  return (
    <div
      className={cn(
        "group/row transition-colors duration-200",
        isEditing ? "rounded-xl" : "rounded-[18px]",
        menuOpen && "bg-background dark:bg-bg-elevated",
      )}
      ref={menuRef}
    >
      {isEditing ? (
        <ChatRenameEditor
          chat={chat}
          isRenaming={isRenaming}
          onRename={onRename}
          setIsEditing={setIsEditing}
        />
      ) : (
        <ChatRowView
          chat={chat}
          isActive={activeThreadId === chat.id}
          isDeleting={isDeleting}
          isRenaming={isRenaming}
          menuOpen={menuOpen}
          onDelete={onDelete}
          setIsEditing={setIsEditing}
          setMenuOpen={setMenuOpen}
        />
      )}
    </div>
  );
}

function ChatRenameEditor({
  chat,
  isRenaming,
  onRename,
  setIsEditing,
}: {
  chat: SidebarChat;
  isRenaming: boolean;
  onRename: (chat: SidebarChat, title: string) => void;
  setIsEditing: (editing: boolean) => void;
}) {
  return (
    <SidebarInlineRenameInput
      ariaLabel={`Rename ${chat.title || "chat"}`}
      busy={isRenaming}
      initialValue={chat.title || "New chat"}
      onCancel={() => setIsEditing(false)}
      onSubmit={(title) => {
        setIsEditing(false);
        onRename(chat, title);
      }}
      variant="chat"
    />
  );
}

function ChatRowView(props: {
  chat: SidebarChat;
  isActive: boolean;
  isDeleting: boolean;
  isRenaming: boolean;
  menuOpen: boolean;
  onDelete: (chat: SidebarChat) => void;
  setIsEditing: (editing: boolean) => void;
  setMenuOpen: (open: boolean | ((current: boolean) => boolean)) => void;
}) {
  return (
    <>
      <ChatRowLink {...props} />
      <SidebarInlineActions open={props.menuOpen}>
        <SidebarInlineAction
          disabled={props.isRenaming}
          icon={Pencil}
          label="Rename"
          onClick={() => {
            props.setMenuOpen(false);
            props.setIsEditing(true);
          }}
          variant="default"
        />
        <SidebarInlineAction
          disabled={props.isDeleting}
          icon={Trash2}
          label="Delete"
          onClick={() => {
            props.setMenuOpen(false);
            props.onDelete(props.chat);
          }}
          variant="destructive"
        />
      </SidebarInlineActions>
    </>
  );
}

function ChatRowLink({
  chat,
  isActive,
  menuOpen,
  setMenuOpen,
}: {
  chat: SidebarChat;
  isActive: boolean;
  menuOpen: boolean;
  setMenuOpen: (open: boolean | ((current: boolean) => boolean)) => void;
}) {
  return (
    <div className="relative flex items-center rounded-full">
      <Link
        className={cn(
          "relative flex h-8 w-full items-center rounded-full py-1.5 pr-7 pl-[9px] text-left font-medium text-[14px] leading-5 transition-colors",
          isActive
            ? "bg-background text-foreground dark:bg-white/5"
            : "text-fg-secondary hover:bg-background hover:text-foreground dark:hover:bg-white/5",
          menuOpen && "dark:bg-transparent",
        )}
        href={`/chats/${encodeURIComponent(chat.id)}`}
        title={chat.title || "New chat"}
      >
        <span className="min-w-0 flex-1 truncate">{chat.title || "New chat"}</span>
      </Link>
      {chat.activeRunId ? <ChatRunningIndicator /> : null}
      <ChatMenuButton chat={chat} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
    </div>
  );
}

function ChatRunningIndicator() {
  return (
    <Loader2
      aria-label="Run in progress"
      className="pointer-events-none absolute right-2 h-3.5 w-3.5 animate-spin text-primary transition-opacity group-hover/row:opacity-0"
      role="img"
    />
  );
}

function ChatMenuButton({
  chat,
  menuOpen,
  setMenuOpen,
}: {
  chat: SidebarChat;
  menuOpen: boolean;
  setMenuOpen: (open: boolean | ((current: boolean) => boolean)) => void;
}) {
  return (
    <button
      aria-expanded={menuOpen}
      aria-label={`Open ${chat.title || "chat"} menu`}
      className={cn(
        "absolute right-1.5 flex size-5 shrink-0 items-center justify-center rounded-full text-fg-secondary opacity-0 transition-[color,opacity] duration-150 hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100",
        menuOpen && "text-foreground opacity-100",
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen((current) => !current);
      }}
      type="button"
    >
      <MoreVertical aria-hidden="true" className="h-3.5 w-3.5" />
    </button>
  );
}
