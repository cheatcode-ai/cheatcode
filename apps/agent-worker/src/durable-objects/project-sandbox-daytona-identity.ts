import type { DaytonaSandbox } from "@cheatcode/tools-code";

const APP_LABEL = "cheatcode";

export function canonicalSandboxLabels(input: {
  sandboxName: string;
  snapshot: string;
  volumeId: string;
  volumeName: string;
}): Record<string, string> {
  return {
    app: APP_LABEL,
    role: "canonical",
    sandboxId: input.sandboxName,
    sandboxOwner: input.sandboxName,
    snapshot: input.snapshot,
    workspaceVolumeId: input.volumeId,
    workspaceVolumeName: input.volumeName,
  };
}

export function candidateSandboxLabels(input: {
  sandboxName: string;
  snapshot: string;
  upgradeId: string;
  volumeId: string;
  volumeName: string;
}): Record<string, string> {
  return {
    app: APP_LABEL,
    role: "candidate",
    sandboxOwner: input.sandboxName,
    snapshot: input.snapshot,
    upgradeId: input.upgradeId,
    workspaceVolumeId: input.volumeId,
    workspaceVolumeName: input.volumeName,
  };
}

export function retiredSandboxLabels(input: {
  sandbox: DaytonaSandbox;
  sandboxName: string;
  upgradeId: string;
}): Record<string, string> {
  return {
    app: APP_LABEL,
    role: "retired",
    sandboxOwner: input.sandboxName,
    snapshot: input.sandbox.snapshot,
    upgradeId: input.upgradeId,
    ...(input.sandbox.labels["workspaceVolumeId"]
      ? { workspaceVolumeId: input.sandbox.labels["workspaceVolumeId"] }
      : {}),
    ...(input.sandbox.labels["workspaceVolumeName"]
      ? { workspaceVolumeName: input.sandbox.labels["workspaceVolumeName"] }
      : {}),
  };
}

export function isCanonicalSandbox(sandbox: DaytonaSandbox, sandboxName: string): boolean {
  return sandbox.labels["app"] === APP_LABEL && sandbox.labels["sandboxId"] === sandboxName;
}

export function isDesiredCanonicalSandbox(
  sandbox: DaytonaSandbox,
  input: { sandboxName: string; snapshot: string; volumeId?: string; volumeName: string },
): boolean {
  const volumeId = input.volumeId ?? sandbox.labels["workspaceVolumeId"];
  return (
    isCanonicalSandbox(sandbox, input.sandboxName) &&
    sandbox.labels["role"] === "canonical" &&
    sandbox.snapshot === input.snapshot &&
    sandbox.labels["snapshot"] === input.snapshot &&
    typeof volumeId === "string" &&
    volumeId.length > 0 &&
    sandbox.labels["workspaceVolumeId"] === volumeId &&
    sandbox.labels["workspaceVolumeName"] === input.volumeName &&
    hasWorkspaceMount(sandbox, volumeId, input.sandboxName)
  );
}

export function isUpgradeCandidate(
  sandbox: DaytonaSandbox,
  input: {
    sandboxName: string;
    snapshot: string;
    upgradeId: string;
    volumeId: string;
    volumeName: string;
  },
): boolean {
  return (
    sandbox.labels["app"] === APP_LABEL &&
    sandbox.labels["role"] === "candidate" &&
    sandbox.labels["sandboxOwner"] === input.sandboxName &&
    sandbox.labels["snapshot"] === input.snapshot &&
    sandbox.labels["upgradeId"] === input.upgradeId &&
    sandbox.labels["workspaceVolumeId"] === input.volumeId &&
    sandbox.labels["workspaceVolumeName"] === input.volumeName &&
    sandbox.snapshot === input.snapshot &&
    hasWorkspaceMount(sandbox, input.volumeId, input.sandboxName)
  );
}

function hasWorkspaceMount(
  sandbox: DaytonaSandbox,
  volumeId: string,
  sandboxName: string,
): boolean {
  return (
    sandbox.volumes?.some(
      (volume) =>
        volume.volumeId === volumeId &&
        volume.mountPath === "/workspace" &&
        volume.subpath === sandboxName,
    ) === true
  );
}
