import { APIError } from "@cheatcode/observability";
import {
  CanonicalProjectWorkspaceSlugSchema,
  canonicalWorkspaceDigest,
  type InternalWorkspaceReconciliationBody,
  InternalWorkspaceReconciliationBodySchema,
  type InternalWorkspaceReconciliationResponse,
  type SandboxSnapshotReconciliation,
  type WorkspaceTransitionProject,
} from "@cheatcode/types";
import { z } from "zod";
import { WORKSPACE_DIR } from "./project-sandbox-content-support";
import {
  APP_PREVIEW_SLOT_PREFIX,
  PORT_ALLOC_KEY,
  PortAllocationSchema,
  PROC_PREFIX,
  PROCESS_PORT_ALLOC_KEY,
  ProcessPortReservationsSchema,
  type ProcessRecord,
  ProcessRecordSchema,
  pruneExpiredProcessPortReservations,
  shellQuote,
  timeoutSeconds,
} from "./project-sandbox-process-support";
import { ProjectSandboxProcesses } from "./project-sandbox-processes";
import { ProjectWorkspaceSlugSchema, workspaceSlugFromPath } from "./project-sandbox-runtime";
import { ProjectSandboxSnapshotUpgrade } from "./project-sandbox-snapshot-upgrade";

const WorkspaceTransitionScriptResultSchema = z
  .object({ present: z.array(CanonicalProjectWorkspaceSlugSchema) })
  .strict();
const WORKSPACE_TRANSITION_STATE_KEY = "workspace_transition_reconciliation";
const WorkspaceTransitionStateSchema = z
  .object({
    canonicalDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    presentSlugs: z.array(CanonicalProjectWorkspaceSlugSchema).max(10_000),
    releaseSha: z.string().regex(/^[0-9a-f]{40}$/u),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.presentSlugs.some((workspaceSlug, index) => {
        const previous = state.presentSlugs[index - 1];
        return previous !== undefined && previous >= workspaceSlug;
      })
    ) {
      context.addIssue({
        code: "custom",
        message: "Workspace presence evidence must be sorted and unique.",
      });
    }
  });

type WorkspaceTransitionState = z.infer<typeof WorkspaceTransitionStateSchema>;

interface WorkspaceTransitionIdentity {
  canonicalDigest: string;
}

interface ReconciliationPlan {
  affectedProcessNames: Set<string>;
  changedWorkspaceSlugs: Set<string>;
  staleWorkspaceSlugs: Set<string>;
}

export abstract class ProjectSandboxWorkspaceTransition extends ProjectSandboxProcesses {
  public async prepareWorkspaceTransition(
    input: InternalWorkspaceReconciliationBody,
  ): Promise<InternalWorkspaceReconciliationResponse> {
    const parsed = parsePhase(input, "prepare");
    const identity = await transitionIdentity(parsed);
    const existing = await this.loadWorkspaceTransitionState();
    if (existing) {
      this.assertWorkspaceTransitionState(existing, parsed, identity);
      await this.verifyPreparedWorkspaceTransition(parsed.projects, existing.presentSlugs);
      await this.verifyStoredWorkspaceState(parsed.projects);
      return transitionResult(
        parsed,
        identity,
        "prepared",
        pendingSnapshot(this.env.DAYTONA_SANDBOX_SNAPSHOT),
      );
    }
    const records = await this.loadProcessRecords();
    const allocation = PortAllocationSchema.parse(
      (await this.ctx.storage.get(PORT_ALLOC_KEY)) ?? {},
    );
    ProcessPortReservationsSchema.parse((await this.ctx.storage.get(PROCESS_PORT_ALLOC_KEY)) ?? {});
    assertProjectPortTransitionSafe(parsed.projects, allocation.ports);
    const plan = reconciliationPlan(parsed.projects, records, allocation.ports);
    const id = await this.ensureExistingSandboxStarted();
    await this.terminateTransitionProcesses(id, records, plan);
    const present = id ? await this.runWorkspaceTransitionScript(id, parsed.projects) : [];
    const counts = await this.reconcileStoredWorkspaceState(parsed.projects, plan);
    await this.verifyStoredWorkspaceState(parsed.projects);
    await this.ctx.storage.put(
      WORKSPACE_TRANSITION_STATE_KEY,
      WorkspaceTransitionStateSchema.parse({
        canonicalDigest: identity.canonicalDigest,
        presentSlugs: [...present].sort(),
        releaseSha: parsed.releaseSha,
      }),
    );
    return transitionResult(
      parsed,
      identity,
      "prepared",
      pendingSnapshot(this.env.DAYTONA_SANDBOX_SNAPSHOT),
      counts,
    );
  }

  public async finalizeWorkspaceTransition(
    input: InternalWorkspaceReconciliationBody,
  ): Promise<InternalWorkspaceReconciliationResponse> {
    const parsed = parsePhase(input, "finalize");
    const identity = await transitionIdentity(parsed);
    const state = await this.loadWorkspaceTransitionState();
    if (state) {
      this.assertWorkspaceTransitionState(state, parsed, identity);
      await this.verifyPreparedWorkspaceTransition(parsed.projects, state.presentSlugs);
    } else {
      assertCanonicalFinalizationInput(parsed.projects);
      const id = await this.ensureExistingSandboxStarted();
      if (id) {
        await this.verifyWorkspaceTransitionScript(id, parsed.projects);
      }
    }
    await this.verifyStoredWorkspaceState(parsed.projects);
    const snapshot = await this.advanceSnapshotUpgrade(parsed.releaseSha);
    if (snapshot.complete) {
      await this.clearWorkspaceTransitionState();
    }
    return transitionResult(parsed, identity, "completed", snapshot);
  }

  private async verifyPreparedWorkspaceTransition(
    projects: WorkspaceTransitionProject[],
    expectedPresent: string[],
  ): Promise<void> {
    const id = await this.ensureExistingSandboxStarted();
    if (id) {
      await this.verifyWorkspaceTransitionScript(id, projects, expectedPresent);
      return;
    }
    if (expectedPresent.length > 0) {
      throw transitionError("Prepared project folders no longer have a Daytona sandbox.");
    }
  }

  private async loadWorkspaceTransitionState(): Promise<WorkspaceTransitionState | null> {
    const value = await this.ctx.storage.get(WORKSPACE_TRANSITION_STATE_KEY);
    return value === undefined ? null : WorkspaceTransitionStateSchema.parse(value);
  }

  private async clearWorkspaceTransitionState(): Promise<void> {
    await this.ctx.storage.delete(WORKSPACE_TRANSITION_STATE_KEY);
    if ((await this.ctx.storage.get(WORKSPACE_TRANSITION_STATE_KEY)) !== undefined) {
      throw transitionError("Completed workspace transition state could not be removed.");
    }
  }

  private assertWorkspaceTransitionState(
    state: WorkspaceTransitionState,
    input: InternalWorkspaceReconciliationBody,
    identity: WorkspaceTransitionIdentity,
  ): void {
    if (
      state.releaseSha !== input.releaseSha ||
      state.canonicalDigest !== identity.canonicalDigest
    ) {
      throw transitionError("Pending workspace transition belongs to another release contract.");
    }
  }

  private async advanceSnapshotUpgrade(releaseSha: string): Promise<SandboxSnapshotReconciliation> {
    const client = await this.ensureClient();
    return new ProjectSandboxSnapshotUpgrade({
      adoptSandboxId: (sandboxId) => this.adoptDaytonaId(sandboxId),
      client,
      ctx: this.ctx,
      env: this.env,
      killProcesses: () => super.killAllProcesses(),
      provisioning: this.sandboxProvisioning(),
      sandboxName: this.sandboxName(),
      toUpstreamError: (error, fallback) => this.toUpstreamError(error, fallback),
    }).advance(releaseSha);
  }

  private async loadProcessRecords(): Promise<Map<string, ProcessRecord>> {
    const stored = await this.ctx.storage.list({ prefix: PROC_PREFIX });
    const records = new Map<string, ProcessRecord>();
    for (const [key, value] of stored) {
      const parsed = ProcessRecordSchema.safeParse(value);
      if (!parsed.success) {
        throw transitionError("Stored sandbox process state is invalid.");
      }
      records.set(key.slice(PROC_PREFIX.length), parsed.data);
    }
    return records;
  }

  private async terminateTransitionProcesses(
    id: string | null,
    records: Map<string, ProcessRecord>,
    plan: ReconciliationPlan,
  ): Promise<void> {
    if (id) {
      for (const workspaceSlug of [...plan.staleWorkspaceSlugs].sort()) {
        await this.terminateUntrackedWorkspaceProcesses(id, workspaceSlug);
      }
    }
    for (const processName of [...plan.affectedProcessNames].sort()) {
      if (id && records.has(processName)) {
        await this.deleteProcessRecord(id, processName);
      } else {
        await this.ctx.storage.delete(`${PROC_PREFIX}${processName}`);
      }
    }
  }

  private async reconcileStoredWorkspaceState(
    projects: WorkspaceTransitionProject[],
    plan: ReconciliationPlan,
  ): Promise<{
    processPortReservationsRemoved: number;
    processRecordsRemoved: number;
    projectPortsRemoved: number;
  }> {
    const canonical = canonicalWorkspaceSet(projects);
    const canonicalForCurrent = new Map(
      projects.map((project) => [project.currentWorkspaceSlug, project.canonicalWorkspaceSlug]),
    );
    return this.ctx.storage.transaction(async (transaction) => {
      const storedAllocation = await transaction.get(PORT_ALLOC_KEY);
      const allocation = PortAllocationSchema.parse(storedAllocation ?? {});
      const { ports, removed: projectPortsRemoved } = canonicalProjectPorts(
        allocation.ports,
        canonical,
        canonicalForCurrent,
      );
      if (storedAllocation !== undefined || Object.keys(ports).length > 0) {
        await transaction.put(PORT_ALLOC_KEY, { ...allocation, ports });
      }

      const records = await transaction.list({ prefix: PROC_PREFIX });
      const storedReservations = await transaction.get(PROCESS_PORT_ALLOC_KEY);
      const before = ProcessPortReservationsSchema.parse(storedReservations ?? {});
      const pruned = pruneExpiredProcessPortReservations(before, records, Date.now());
      const reservations = canonicalProcessPortReservations(
        pruned,
        canonical,
        plan.affectedProcessNames,
      );
      if (storedReservations !== undefined || Object.keys(reservations).length > 0) {
        await transaction.put(PROCESS_PORT_ALLOC_KEY, reservations);
      }
      return {
        processPortReservationsRemoved:
          Object.keys(before).length - Object.keys(reservations).length,
        processRecordsRemoved: plan.affectedProcessNames.size,
        projectPortsRemoved,
      };
    });
  }

  private async verifyStoredWorkspaceState(projects: WorkspaceTransitionProject[]): Promise<void> {
    const canonical = canonicalWorkspaceSet(projects);
    const records = await this.loadProcessRecords();
    for (const [name, record] of records) {
      if (processNeedsRemoval(name, record, canonical, new Set())) {
        throw transitionError("Noncanonical sandbox process state remains after reconciliation.");
      }
    }
    const allocation = PortAllocationSchema.parse(
      (await this.ctx.storage.get(PORT_ALLOC_KEY)) ?? {},
    );
    if (Object.keys(allocation.ports).some((workspaceSlug) => !canonical.has(workspaceSlug))) {
      throw transitionError("Noncanonical project port state remains after reconciliation.");
    }
    const reservations = ProcessPortReservationsSchema.parse(
      (await this.ctx.storage.get(PROCESS_PORT_ALLOC_KEY)) ?? {},
    );
    if (
      Object.keys(reservations).some((processId) => {
        const slot = previewSlotWorkspaceSlug(processId);
        return slot === "invalid" || (slot !== null && !canonical.has(slot));
      })
    ) {
      throw transitionError("Noncanonical process port state remains after reconciliation.");
    }
  }

  private async runWorkspaceTransitionScript(
    id: string,
    projects: WorkspaceTransitionProject[],
  ): Promise<string[]> {
    return this.executeWorkspaceTransitionScript(id, { mode: "prepare", projects });
  }

  private async verifyWorkspaceTransitionScript(
    id: string,
    projects: WorkspaceTransitionProject[],
    expectedPresent?: string[],
  ): Promise<void> {
    const present = await this.executeWorkspaceTransitionScript(id, { mode: "verify", projects });
    if (expectedPresent) {
      assertSameSlugs(present, expectedPresent);
    }
  }

  private async executeWorkspaceTransitionScript(
    id: string,
    payload: {
      mode: "prepare" | "verify";
      projects: WorkspaceTransitionProject[];
    },
  ): Promise<string[]> {
    const encoded = btoa(JSON.stringify(payload));
    const result = await this.client().execute(id, {
      command: `python3 -c ${shellQuote(WORKSPACE_TRANSITION_SCRIPT)} ${shellQuote(encoded)}`,
      cwd: WORKSPACE_DIR,
      timeout: timeoutSeconds(120_000),
    });
    if (result.exitCode !== 0) {
      throw transitionError("Project workspace folders could not be reconciled.", result.result);
    }
    const parsed = WorkspaceTransitionScriptResultSchema.safeParse(parseJson(result.result));
    if (!parsed.success) {
      throw transitionError("Project workspace transition returned invalid evidence.");
    }
    return parsed.data.present;
  }
}

function reconciliationPlan(
  projects: WorkspaceTransitionProject[],
  records: Map<string, ProcessRecord>,
  projectPorts: Record<string, number>,
): ReconciliationPlan {
  const canonical = canonicalWorkspaceSet(projects);
  const changedWorkspaceSlugs = new Set(
    projects
      .filter((project) => project.currentWorkspaceSlug !== project.canonicalWorkspaceSlug)
      .flatMap((project) => [project.currentWorkspaceSlug, project.canonicalWorkspaceSlug]),
  );
  const staleWorkspaceSlugs = new Set(
    projects
      .filter((project) => project.currentWorkspaceSlug !== project.canonicalWorkspaceSlug)
      .flatMap((project) => [project.currentWorkspaceSlug, project.canonicalWorkspaceSlug]),
  );
  for (const workspaceSlug of Object.keys(projectPorts)) {
    if (!canonical.has(workspaceSlug)) {
      const parsed = ProjectWorkspaceSlugSchema.safeParse(workspaceSlug);
      if (parsed.success) {
        staleWorkspaceSlugs.add(parsed.data);
      }
    }
  }
  const affectedProcessNames = new Set<string>();
  for (const [name, record] of records) {
    const scopes = processWorkspaceSlugs(name, record);
    for (const scope of scopes) {
      if (scope !== "invalid" && !canonical.has(scope)) {
        staleWorkspaceSlugs.add(scope);
      }
    }
    if (processNeedsRemoval(name, record, canonical, changedWorkspaceSlugs)) {
      affectedProcessNames.add(name);
    }
  }
  return { affectedProcessNames, changedWorkspaceSlugs, staleWorkspaceSlugs };
}

function canonicalProjectPorts(
  current: Record<string, number>,
  canonical: ReadonlySet<string>,
  canonicalForCurrent: ReadonlyMap<string, string>,
): { ports: Record<string, number>; removed: number } {
  const ports: Record<string, number> = {};
  let removed = 0;
  for (const [workspaceSlug, port] of Object.entries(current)) {
    const target = canonicalForCurrent.get(workspaceSlug) ?? workspaceSlug;
    if (!canonical.has(target)) {
      removed += 1;
      continue;
    }
    if (ports[target] !== undefined && ports[target] !== port) {
      throw transitionError("Canonical project port allocation collides with another port.");
    }
    if (target !== workspaceSlug) {
      removed += 1;
    }
    ports[target] = port;
  }
  return { ports, removed };
}

function canonicalProcessPortReservations(
  current: z.infer<typeof ProcessPortReservationsSchema>,
  canonical: ReadonlySet<string>,
  affectedProcessNames: ReadonlySet<string>,
): z.infer<typeof ProcessPortReservationsSchema> {
  return Object.fromEntries(
    Object.entries(current).filter(([processId]) => {
      if (affectedProcessNames.has(processId)) {
        return false;
      }
      const slot = previewSlotWorkspaceSlug(processId);
      return slot === null || (slot !== "invalid" && canonical.has(slot));
    }),
  );
}

function assertProjectPortTransitionSafe(
  projects: WorkspaceTransitionProject[],
  projectPorts: Record<string, number>,
): void {
  const canonical = canonicalWorkspaceSet(projects);
  const canonicalForCurrent = new Map(
    projects.map((project) => [project.currentWorkspaceSlug, project.canonicalWorkspaceSlug]),
  );
  const ports = new Map<string, number>();
  for (const [workspaceSlug, port] of Object.entries(projectPorts)) {
    const target = canonicalForCurrent.get(workspaceSlug) ?? workspaceSlug;
    if (!canonical.has(target)) {
      continue;
    }
    const existing = ports.get(target);
    if (existing !== undefined && existing !== port) {
      throw transitionError("Canonical project port allocation collides with another port.");
    }
    ports.set(target, port);
  }
}

function processNeedsRemoval(
  name: string,
  record: ProcessRecord,
  canonical: ReadonlySet<string>,
  changed: ReadonlySet<string>,
): boolean {
  const scopes = processWorkspaceSlugs(name, record);
  return scopes.some((scope) => scope === "invalid" || !canonical.has(scope) || changed.has(scope));
}

function processWorkspaceSlugs(name: string, record: ProcessRecord): Array<string | "invalid"> {
  const scopes: Array<string | "invalid"> = [];
  const cwdSlug = workspaceSlugFromPath(record.cwd);
  if (cwdSlug) {
    scopes.push(cwdSlug);
  } else if (record.cwd !== WORKSPACE_DIR && record.cwd.startsWith(`${WORKSPACE_DIR}/`)) {
    scopes.push("invalid");
  }
  const slotSlug = previewSlotWorkspaceSlug(name);
  if (slotSlug !== null && !scopes.includes(slotSlug)) {
    scopes.push(slotSlug);
  }
  return scopes;
}

function previewSlotWorkspaceSlug(processId: string): string | "invalid" | null {
  if (!processId.startsWith(APP_PREVIEW_SLOT_PREFIX)) {
    return null;
  }
  const parsed = ProjectWorkspaceSlugSchema.safeParse(
    processId.slice(APP_PREVIEW_SLOT_PREFIX.length),
  );
  return parsed.success ? parsed.data : "invalid";
}

function canonicalWorkspaceSet(projects: WorkspaceTransitionProject[]): Set<string> {
  return new Set(projects.map((project) => project.canonicalWorkspaceSlug));
}

function assertCanonicalFinalizationInput(projects: WorkspaceTransitionProject[]): void {
  if (projects.some((project) => project.currentWorkspaceSlug !== project.canonicalWorkspaceSlug)) {
    throw transitionError("Workspace transition evidence is absent before canonical commit.");
  }
}

async function transitionIdentity(
  input: InternalWorkspaceReconciliationBody,
): Promise<WorkspaceTransitionIdentity> {
  const projects = [...input.projects].sort((left, right) =>
    left.projectId.localeCompare(right.projectId),
  );
  return {
    canonicalDigest: await canonicalWorkspaceDigest(
      projects.map((project) => project.canonicalWorkspaceSlug),
    ),
  };
}

function parsePhase(
  input: InternalWorkspaceReconciliationBody,
  phase: "finalize" | "prepare",
): InternalWorkspaceReconciliationBody {
  const parsed = InternalWorkspaceReconciliationBodySchema.parse(input);
  if (parsed.phase !== phase) {
    throw transitionError(`Workspace transition phase must be ${phase}.`);
  }
  return parsed;
}

function transitionResult(
  input: InternalWorkspaceReconciliationBody,
  identity: WorkspaceTransitionIdentity,
  transitionPhase: "completed" | "prepared",
  snapshot: SandboxSnapshotReconciliation,
  counts = {
    processPortReservationsRemoved: 0,
    processRecordsRemoved: 0,
    projectPortsRemoved: 0,
  },
): InternalWorkspaceReconciliationResponse {
  return {
    canonicalDigest: identity.canonicalDigest,
    canonicalWorkspaceCount: input.projects.length,
    ...counts,
    ok: true,
    releaseSha: input.releaseSha,
    snapshot,
    transitionPhase,
    verified: true,
  };
}

function pendingSnapshot(targetSnapshot: string): SandboxSnapshotReconciliation {
  return {
    complete: false,
    sourceSnapshot: null,
    status: "upgrading",
    targetSnapshot,
    upgradeId: null,
    workspaceDigest: null,
  };
}

function parseJson(value: string | null | undefined): unknown {
  try {
    return JSON.parse(value ?? "") as unknown;
  } catch {
    return null;
  }
}

function assertSameSlugs(actual: readonly string[], expected: readonly string[]): void {
  if ([...actual].sort().join("\n") !== [...expected].sort().join("\n")) {
    throw transitionError("Project workspace folder evidence changed during transition.");
  }
}

function transitionError(message: string, output?: string | null): APIError {
  return new APIError(409, "conflict_state_invalid", message, {
    ...(output ? { details: { output: output.slice(-1_000) } } : {}),
    retriable: false,
  });
}

const WORKSPACE_TRANSITION_SCRIPT = `
import base64
import json
import os
import stat
import sys

payload = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
root = "/workspace"
projects = payload["projects"]

def path_for(slug):
    return os.path.join(root, slug)

def kind(path):
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return "absent"
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeError(f"Workspace path is not a real directory: {path}")
    return "directory"

states = []
for project in projects:
    current = project["currentWorkspaceSlug"]
    canonical = project["canonicalWorkspaceSlug"]
    current_kind = kind(path_for(current))
    canonical_kind = current_kind if current == canonical else kind(path_for(canonical))
    if current != canonical and current_kind == "directory" and canonical_kind == "directory":
        raise RuntimeError(f"Workspace rename destination already exists: {canonical}")
    states.append((current, canonical, current_kind, canonical_kind))

if payload["mode"] == "prepare":
    for current, canonical, current_kind, canonical_kind in states:
        if current != canonical and current_kind == "directory" and canonical_kind == "absent":
            os.rename(path_for(current), path_for(canonical))

present = []
for project in projects:
    current = project["currentWorkspaceSlug"]
    canonical = project["canonicalWorkspaceSlug"]
    if current != canonical and kind(path_for(current)) != "absent":
        raise RuntimeError(f"Noncanonical workspace still exists: {current}")
    if kind(path_for(canonical)) == "directory":
        present.append(canonical)

present.sort()
print(json.dumps({"present": present}, separators=(",", ":")))
`;
