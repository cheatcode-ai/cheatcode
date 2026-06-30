import { createChat, listProjectThreads, threadTitle } from "@/lib/api/project-thread";
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
  const threads = await listProjectThreads(getToken, projectId);
  const newest = threads[0] ?? null;
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
 * Builds the `?prompt|promptKey=…` handoff query for routing into a chat
 * (`/chats/{threadId}`) so the workspace auto-runs the first message. The chat id
 * rides the path, not the query. Carries no `surface`/`model` — the chat's launch
 * intent owns the build surface and a per-run model choice rides the zustand store.
 */
export function buildExistingProjectParams(prompt: string): URLSearchParams {
  const params = new URLSearchParams();
  const handoff = createPromptHandoff(prompt);
  if (handoff.prompt) {
    params.set("prompt", handoff.prompt);
  }
  if (handoff.promptKey) {
    params.set("promptKey", handoff.promptKey);
  }
  return params;
}
