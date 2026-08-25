import type { UserId } from "@cheatcode/types";

export interface GatewayPrimaryEmailStatus {
  email: string | null;
  verified: boolean;
}

export interface GatewayPrincipal {
  clerkUserId: string;
  primaryEmailStatus(): Promise<GatewayPrimaryEmailStatus>;
  userId: UserId;
}
