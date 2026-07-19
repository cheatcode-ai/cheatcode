import { APIError } from "@cheatcode/observability";
import { z } from "zod";

const SANDBOX_OWNER_USER_ID_KEY = "sandbox_owner_user_id";
const SANDBOX_NAME_KEY = "sandbox_name";
const OwnerUserIdSchema = z.string().uuid();

export class ProjectSandboxIdentityState {
  private cachedOwnerUserId: string | null = null;
  private cachedSandboxName: string | undefined;

  constructor(private readonly ctx: DurableObjectState) {}

  public async initialize(): Promise<void> {
    const fromId = this.ctx.id.name;
    const [storedName, storedOwnerUserId] = await Promise.all([
      this.ctx.storage.get<string>(SANDBOX_NAME_KEY),
      this.ctx.storage.get<string>(SANDBOX_OWNER_USER_ID_KEY),
    ]);
    if (fromId) {
      this.cachedSandboxName = fromId;
    } else if (typeof storedName === "string") {
      this.cachedSandboxName = storedName;
    }
    if (storedOwnerUserId !== undefined) {
      this.cachedOwnerUserId = OwnerUserIdSchema.parse(storedOwnerUserId);
    }
  }

  public async registerOwner(userId: string, sandboxName?: string): Promise<void> {
    const resolvedSandboxName = this.sandboxName();
    if (sandboxName && resolvedSandboxName !== sandboxName) {
      throw new APIError(403, "permission_denied", "Sandbox identity mismatch", {
        retriable: false,
      });
    }
    const parsedUserId = OwnerUserIdSchema.parse(userId);
    const existingUserId = this.cachedOwnerUserId;
    if (existingUserId && existingUserId !== parsedUserId) {
      throw new APIError(403, "permission_denied", "Sandbox ownership mismatch", {
        retriable: false,
      });
    }
    if (existingUserId === parsedUserId) {
      return;
    }
    await this.ctx.storage.put({
      [SANDBOX_NAME_KEY]: resolvedSandboxName,
      [SANDBOX_OWNER_USER_ID_KEY]: parsedUserId,
    });
    this.cachedOwnerUserId = parsedUserId;
    this.cachedSandboxName = resolvedSandboxName;
  }

  public ownerUserId(): string | null {
    return this.cachedOwnerUserId;
  }

  public hasRegisteredOwner(): boolean {
    return this.cachedOwnerUserId !== null;
  }

  public clearRegisteredOwner(): void {
    this.cachedOwnerUserId = null;
  }

  public sandboxName(): string {
    const name = this.cachedSandboxName ?? this.ctx.id.name;
    if (!name) {
      throw new Error("ProjectSandbox must be addressed with idFromName().");
    }
    return name;
  }
}
