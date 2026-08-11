import type { RunIntent } from "@cheatcode/types/api";
import { createChat, listProjectThreadsPage, threadTitle } from "@/lib/api/project-thread";
import { createPromptHandoff } from "@/lib/input/prompt-handoff";

export type LaunchIntoProjectResult = { busy: true } | { busy?: false; threadId: string };

/**
 * Resolves the target chat for a home submit into an existing project: the
 * project's newest thread (server orders `desc(updatedAt)`, so element 0), else a
 * fresh chat. Includes the busy preflight — if the newest thread already has an
 * active run, returns `{ busy: true }` with no chat create and no navigation so the
 * caller keeps the typed prompt (prevents the post-navigation 409 prompt-loss
 * path). `activeRunId` rides every thread row, so this costs no extra requests.
 */
export async function launchIntoProject(
  getToken: () => Promise<null | string>,
  projectId: string,
  prompt: string,
): Promise<LaunchIntoProjectResult> {
  const page = await listProjectThreadsPage(getToken, projectId, null, 1);
  const newest = page.data[0] ?? null;
  if (newest) {
    if (newest.activeRunId !== null) {
      return { busy: true };
    }
    return { threadId: newest.id };
  }
  const created = await createChat(getToken, { projectId, title: threadTitle(prompt) });
  return { threadId: created.id };
}

/**
 * Builds the opaque `?promptKey=…` handoff query for routing into a chat
 * (`/chats/{threadId}`) so the workspace auto-runs the first message. The chat id
 * rides the path, not the query. App target, repository import, and default model
 * are already persisted on the newly created chat; this handoff carries only the
 * prompt and constrained run intent consumed by the chat workspace.
 */
export function buildExistingProjectParams(
  prompt: string,
  intent: RunIntent | null = null,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("promptKey", createPromptHandoff(prompt).promptKey);
  if (intent) {
    params.set("intent", intent);
  }
  return params;
}
