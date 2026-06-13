import { createProjectThread, listProjectThreads, threadTitle } from "@/lib/api/project-thread";
import { createPromptHandoff } from "@/lib/input/prompt-handoff";

export type LaunchIntoProjectResult = { busy: true } | { busy?: false; threadId: string };

/**
 * Resolves the target thread for a home submit into an existing project: the
 * project's newest thread (server orders `desc(updatedAt)`, so element 0), else a
 * fresh thread. Includes the busy preflight — if the newest thread already has an
 * active run, returns `{ busy: true }` with no thread create and no navigation so
 * the caller keeps the typed prompt (prevents the post-navigation 409 prompt-loss
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
  const created = await createProjectThread(getToken, projectId, { title: threadTitle(prompt) });
  return { threadId: created.id };
}

/**
 * Builds the `?thread=…&prompt|promptKey=…` params for routing into an existing
 * project's thread. Carries no `surface` or `model` (the project's settings own
 * those; a per-run model choice rides the zustand store).
 */
export function buildExistingProjectParams(threadId: string, prompt: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("thread", threadId);
  const handoff = createPromptHandoff(prompt);
  if (handoff.prompt) {
    params.set("prompt", handoff.prompt);
  }
  if (handoff.promptKey) {
    params.set("promptKey", handoff.promptKey);
  }
  return params;
}
