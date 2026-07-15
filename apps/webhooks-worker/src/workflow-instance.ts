type ExistingWorkflowStatus =
  | "complete"
  | "errored"
  | "paused"
  | "queued"
  | "running"
  | "terminated"
  | "unknown"
  | "waiting"
  | "waitingForPause";

export interface DeterministicWorkflowResult {
  id: string;
  reused: boolean;
  status: "created" | ExistingWorkflowStatus;
}

/**
 * Create a deterministic Workflow instance. Cloudflare rejects duplicate IDs, so a
 * retained instance is inspected explicitly: active/complete work is reused and a
 * terminally failed instance is restarted with its original immutable parameters.
 */
export async function createDeterministicWorkflow<Payload>(
  workflow: Workflow<Payload>,
  options: WorkflowInstanceCreateOptions<Payload>,
): Promise<DeterministicWorkflowResult> {
  if (!options.id) {
    throw new Error("A deterministic Workflow id is required");
  }
  try {
    const instance = await workflow.create(options);
    return { id: instance.id, reused: false, status: "created" };
  } catch (createError) {
    return reuseExistingWorkflow(workflow, options.id, createError);
  }
}

async function reuseExistingWorkflow<Payload>(
  workflow: Workflow<Payload>,
  id: string,
  createError: unknown,
): Promise<DeterministicWorkflowResult> {
  try {
    const instance = await workflow.get(id);
    const { status } = await instance.status();
    if (status === "unknown") {
      throw createError;
    }
    if (status === "errored" || status === "terminated") {
      await instance.restart();
    }
    return { id: instance.id, reused: true, status };
  } catch {
    throw createError;
  }
}
