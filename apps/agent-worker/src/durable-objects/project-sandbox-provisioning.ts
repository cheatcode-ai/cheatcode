import { APIError } from "@cheatcode/observability";
import {
  DaytonaApiError,
  type DaytonaClient,
  type DaytonaSandbox,
  type DaytonaVolume,
} from "@cheatcode/tools-code";
import {
  canonicalSandboxLabels,
  isCanonicalSandbox,
  isDesiredCanonicalSandbox,
} from "./project-sandbox-daytona-identity";
import {
  AUTO_ARCHIVE_MIN,
  DEFAULT_IDLE_STOP_MIN,
  ENSURE_STARTED_ATTEMPTS,
  ENSURE_STARTED_DELAY_MS,
  isDaytonaNameConflictError,
  isStartableState,
  NEVER_AUTO_DELETE,
  type ProjectSandboxEnv,
} from "./project-sandbox-lifecycle-support";
import { isDestroyed, isFailedState, sleep } from "./project-sandbox-process-support";

const WORKSPACE_MOUNT_PATH = "/workspace";
const VOLUME_READY_ATTEMPTS = 60;
const VOLUME_READY_DELAY_MS = 2_000;

interface ProjectSandboxProvisioningInput {
  cachedSandboxId: () => Promise<string | null>;
  env: ProjectSandboxEnv;
  sandboxName: () => string;
  toUpstreamError: (error: unknown, fallback: string) => APIError;
}

/** Resolves one canonical Daytona sandbox and brings it to a started state. */
export class ProjectSandboxProvisioning {
  public constructor(private readonly input: ProjectSandboxProvisioningInput) {}

  public async resolve(client: DaytonaClient): Promise<DaytonaSandbox> {
    const name = this.input.sandboxName();
    const resolved = (await this.findExisting(client)) ?? (await this.create(client, name));
    if (this.isDesired(resolved)) {
      return resolved;
    }
    throw new APIError(
      503,
      "unavailable_maintenance",
      "Sandbox requires release-scoped snapshot reconciliation",
      {
        details: {
          actualSnapshot: resolved.snapshot,
          expectedSnapshot: this.input.env.DAYTONA_SANDBOX_SNAPSHOT,
          sandboxId: name,
        },
        retriable: false,
      },
    );
  }

  public async findExisting(client: DaytonaClient): Promise<DaytonaSandbox | null> {
    const cachedId = await this.input.cachedSandboxId();
    if (cachedId) {
      const existing = await client.getSandbox(cachedId);
      if (
        existing &&
        !isDestroyed(existing) &&
        isCanonicalSandbox(existing, this.input.sandboxName())
      ) {
        return existing;
      }
    }
    return this.findByLabels(client);
  }

  public async findOwned(client: DaytonaClient): Promise<DaytonaSandbox[]> {
    const sandboxName = this.input.sandboxName();
    const owned = await client.listSandboxesByLabels({
      app: "cheatcode",
      sandboxOwner: sandboxName,
    });
    return owned.filter(
      (sandbox) => !isDestroyed(sandbox) && sandbox.labels["sandboxOwner"] === sandboxName,
    );
  }

  public async ensureStarted(client: DaytonaClient, sandbox: DaytonaSandbox): Promise<boolean> {
    if (sandbox.state === "started") {
      return true;
    }
    let hasRequestedStart = await this.startIfPossible(client, sandbox);
    for (let attempt = 0; attempt < ENSURE_STARTED_ATTEMPTS; attempt += 1) {
      const current = await client.getSandbox(sandbox.id);
      if (!current) {
        return false;
      }
      if (current.state === "started") {
        return true;
      }
      if (!hasRequestedStart) {
        hasRequestedStart = await this.startIfPossible(client, current);
      }
      if (isFailedState(current.state)) {
        throw new APIError(
          502,
          "upstream_sandbox_failed",
          `Daytona sandbox in state ${current.state}`,
          {
            details: { sandboxId: this.input.sandboxName(), state: current.state },
            retriable: true,
          },
        );
      }
      await sleep(ENSURE_STARTED_DELAY_MS);
    }
    throw new APIError(
      504,
      "upstream_sandbox_failed",
      "Daytona sandbox did not reach started state",
      { retriable: true },
    );
  }

  public async restart(client: DaytonaClient, sandboxId: string): Promise<void> {
    await client.stopSandbox(sandboxId).catch((error: unknown) => {
      throw this.input.toUpstreamError(error, "Daytona sandbox failed to stop for recovery.");
    });
    for (let attempt = 0; attempt < ENSURE_STARTED_ATTEMPTS; attempt += 1) {
      const current = await client.getSandbox(sandboxId);
      if (!current) {
        throw new APIError(502, "upstream_sandbox_failed", "Daytona sandbox disappeared", {
          retriable: true,
        });
      }
      if (isStartableState(current.state)) {
        if (await this.ensureStarted(client, current)) {
          return;
        }
        break;
      }
      if (isFailedState(current.state)) {
        throw new APIError(
          502,
          "upstream_sandbox_failed",
          `Daytona sandbox in state ${current.state}`,
          {
            details: { sandboxId: this.input.sandboxName(), state: current.state },
            retriable: true,
          },
        );
      }
      await sleep(ENSURE_STARTED_DELAY_MS);
    }
    throw new APIError(
      504,
      "upstream_sandbox_failed",
      "Daytona sandbox did not stop for recovery",
      { retriable: true },
    );
  }

  public async ensureWorkspaceVolume(client: DaytonaClient): Promise<DaytonaVolume> {
    const name = this.input.env.DAYTONA_WORKSPACE_VOLUME;
    let volume = await client.getVolumeByName(name);
    if (!volume) {
      try {
        volume = await client.createVolume(name);
      } catch (error) {
        if (!(error instanceof DaytonaApiError) || error.status !== 409) {
          throw this.input.toUpstreamError(error, "Daytona workspace volume creation failed.");
        }
        volume = await client.getVolumeByName(name);
      }
    }
    if (!volume) {
      throw new APIError(502, "upstream_sandbox_failed", "Daytona workspace volume disappeared", {
        retriable: true,
      });
    }
    return this.waitForReadyVolume(client, volume);
  }

  public isDesired(sandbox: DaytonaSandbox): boolean {
    return isDesiredCanonicalSandbox(sandbox, {
      sandboxName: this.input.sandboxName(),
      snapshot: this.input.env.DAYTONA_SANDBOX_SNAPSHOT,
      volumeName: this.input.env.DAYTONA_WORKSPACE_VOLUME,
    });
  }

  private async create(client: DaytonaClient, name: string): Promise<DaytonaSandbox> {
    try {
      const volume = await this.ensureWorkspaceVolume(client);
      const created = await client.createSandbox({
        name,
        snapshot: this.input.env.DAYTONA_SANDBOX_SNAPSHOT,
        target: this.input.env.DAYTONA_TARGET,
        user: "node",
        labels: canonicalSandboxLabels({
          sandboxName: name,
          snapshot: this.input.env.DAYTONA_SANDBOX_SNAPSHOT,
          volumeId: volume.id,
          volumeName: volume.name,
        }),
        volumes: [{ mountPath: WORKSPACE_MOUNT_PATH, subpath: name, volumeId: volume.id }],
        autoStopInterval: DEFAULT_IDLE_STOP_MIN,
        autoArchiveInterval: AUTO_ARCHIVE_MIN,
        autoDeleteInterval: NEVER_AUTO_DELETE,
      });
      this.assertIdentity(created);
      return created;
    } catch (error) {
      if (isDaytonaNameConflictError(error)) {
        const existing = await this.findAfterCreateConflict(client, name);
        if (existing) {
          return existing;
        }
      }
      throw this.input.toUpstreamError(error, "Daytona sandbox failed to start.");
    }
  }

  private async findAfterCreateConflict(
    client: DaytonaClient,
    name: string,
  ): Promise<DaytonaSandbox | null> {
    const byLabel = await this.findByLabels(client);
    if (byLabel) {
      return byLabel;
    }
    const byName = await client.getSandbox(name);
    if (byName && !isDestroyed(byName)) {
      this.assertIdentity(byName);
      return byName;
    }
    return null;
  }

  private async findByLabels(client: DaytonaClient): Promise<DaytonaSandbox | null> {
    const sandboxName = this.input.sandboxName();
    const byLabel = await client.listSandboxesByLabels({
      app: "cheatcode",
      sandboxId: sandboxName,
    });
    const live = byLabel.filter((sandbox) => !isDestroyed(sandbox));
    if (live.length > 1) {
      throw new APIError(409, "conflict_state_invalid", "Multiple active sandboxes found", {
        details: { daytonaIds: live.map((sandbox) => sandbox.id), sandboxId: sandboxName },
        hint: "Resolve the duplicate Daytona sandboxes explicitly before retrying.",
        retriable: false,
      });
    }
    const listed = live[0];
    if (!listed) {
      return null;
    }
    const sandbox = await client.getSandbox(listed.id);
    if (!sandbox || isDestroyed(sandbox)) {
      return null;
    }
    this.assertIdentity(sandbox);
    return sandbox;
  }

  public assertIdentity(sandbox: DaytonaSandbox): void {
    const name = this.input.sandboxName();
    if (isCanonicalSandbox(sandbox, name)) {
      return;
    }
    throw new APIError(409, "conflict_state_invalid", "Daytona sandbox identity mismatch", {
      details: { actualName: sandbox.name, daytonaId: sandbox.id, expectedName: name },
      hint: "Inspect the sandbox labels and durable object binding before retrying.",
      retriable: false,
    });
  }

  private async waitForReadyVolume(
    client: DaytonaClient,
    initial: DaytonaVolume,
  ): Promise<DaytonaVolume> {
    let volume = initial;
    for (let attempt = 0; attempt < VOLUME_READY_ATTEMPTS; attempt += 1) {
      if (volume.state === "ready") {
        return volume;
      }
      if (volume.state === "error") {
        throw new APIError(502, "upstream_sandbox_failed", "Daytona workspace volume failed", {
          details: { volumeId: volume.id },
          retriable: false,
        });
      }
      await sleep(VOLUME_READY_DELAY_MS);
      const current = await client.getVolumeByName(volume.name);
      if (!current) {
        throw new APIError(502, "upstream_sandbox_failed", "Daytona workspace volume disappeared", {
          retriable: true,
        });
      }
      volume = current;
    }
    throw new APIError(504, "upstream_sandbox_failed", "Daytona workspace volume was not ready", {
      retriable: true,
    });
  }

  private async startIfPossible(client: DaytonaClient, sandbox: DaytonaSandbox): Promise<boolean> {
    if (!isStartableState(sandbox.state)) {
      return false;
    }
    await client.startSandbox(sandbox.id).catch((error: unknown) => {
      throw this.input.toUpstreamError(error, "Daytona sandbox failed to start.");
    });
    return true;
  }
}
