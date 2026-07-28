import type { ResourceDeletionJobLease } from "@cheatcode/db";
import type { ResourceDeletionWorkflowPayload } from "@cheatcode/types";
import { continuationLeaseToken as createContinuationLeaseToken } from "./deletion-job-runner";

export interface ResourceDeletionWorkflowBindings {
  RESOURCE_DELETION_WORKFLOW: Workflow<ResourceDeletionWorkflowPayload>;
}

class ResourceDeletionInstanceCreationError extends Error {
  public constructor(actual: number, expected: number) {
    super(`Workflow batch created ${actual} of ${expected} resource deletion instances`);
    this.name = "ResourceDeletionInstanceCreationError";
  }
}

class ResourceDeletionInstanceInvariantError extends Error {
  public readonly retriable = false;
}

export async function createResourceDeletionInstances(
  env: ResourceDeletionWorkflowBindings,
  leases: ResourceDeletionJobLease[],
): Promise<number> {
  const instances = await env.RESOURCE_DELETION_WORKFLOW.createBatch(
    leases.map((lease) => ({
      id: resourceDeletionInstanceId(lease),
      params: workflowPayload(lease),
      retention: { errorRetention: "7 days", successRetention: "1 day" },
    })),
  );
  if (instances.length !== leases.length) {
    throw new ResourceDeletionInstanceCreationError(instances.length, leases.length);
  }
  return instances.length;
}

/** Keeps replayed continuation reservation attempts on the same fencing identity. */
export async function continuationLeaseToken(lease: ResourceDeletionJobLease): Promise<string> {
  return createContinuationLeaseToken(
    `${lease.jobId}:${lease.continuation + 1}`,
    () => new ResourceDeletionInstanceInvariantError("Continuation lease digest was incomplete"),
  );
}

function workflowPayload(lease: ResourceDeletionJobLease): ResourceDeletionWorkflowPayload {
  return {
    continuation: lease.continuation,
    jobId: lease.jobId,
    leaseToken: lease.leaseToken,
    userId: lease.userId,
  };
}

function resourceDeletionInstanceId(lease: ResourceDeletionJobLease): string {
  return `resource-delete-${lease.jobId}-${lease.continuation}`;
}
