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

export function isCanonicalSandbox(sandbox: DaytonaSandbox, sandboxName: string): boolean {
  return (
    sandbox.labels["app"] === APP_LABEL &&
    sandbox.labels["role"] === "canonical" &&
    sandbox.labels["sandboxId"] === sandboxName &&
    sandbox.labels["sandboxOwner"] === sandboxName
  );
}

export function isRuntimeReplaceableCanonicalSandbox(
  sandbox: DaytonaSandbox,
  input: { sandboxName: string; volumeName: string },
): boolean {
  const volumeId = sandbox.labels["workspaceVolumeId"];
  return (
    isCanonicalSandbox(sandbox, input.sandboxName) &&
    sandbox.snapshot === sandbox.labels["snapshot"] &&
    typeof volumeId === "string" &&
    volumeId.length > 0 &&
    sandbox.labels["workspaceVolumeName"] === input.volumeName &&
    hasWorkspaceMount(sandbox, volumeId, input.sandboxName)
  );
}

export function isDesiredCanonicalSandbox(
  sandbox: DaytonaSandbox,
  input: {
    sandboxName: string;
    snapshot: string;
    target: string;
    volumeId?: string;
    volumeName: string;
  },
): boolean {
  const volumeId = input.volumeId ?? sandbox.labels["workspaceVolumeId"];
  return (
    isCanonicalSandbox(sandbox, input.sandboxName) &&
    sandbox.labels["role"] === "canonical" &&
    sandbox.snapshot === input.snapshot &&
    sandbox.labels["snapshot"] === input.snapshot &&
    sandbox.target === input.target &&
    sandbox.user === "node" &&
    typeof volumeId === "string" &&
    volumeId.length > 0 &&
    sandbox.labels["workspaceVolumeId"] === volumeId &&
    sandbox.labels["workspaceVolumeName"] === input.volumeName &&
    hasWorkspaceMount(sandbox, volumeId, input.sandboxName)
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
