import type { ResourceDeletionJobLease } from "@cheatcode/db";
import type { ResourceDeletionWorkflowPayload } from "@cheatcode/types";
import { assertReleaseCanDrain, assertReleaseOpen, type ReleaseGateBindings } from "./release-gate";

export interface ResourceDeletionWorkflowBindings extends ReleaseGateBindings {
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
  options: { continuation?: boolean } = {},
): Promise<number> {
  if (options.continuation) {
    assertReleaseCanDrain(env);
  } else {
    assertReleaseOpen(env);
  }
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
  const input = new TextEncoder().encode(`${lease.jobId}:${lease.continuation + 1}`);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input)).slice(0, 16);
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new ResourceDeletionInstanceInvariantError("Continuation lease digest was incomplete");
  }
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
