import type { DurableObject } from "cloudflare:workers";
import type { QuotaTrackerRpc } from "@cheatcode/types/quota";

type QuotaTrackerObject = DurableObject & QuotaTrackerRpc;
export type QuotaTrackerNamespace = DurableObjectNamespace<QuotaTrackerObject>;
export type QuotaTrackerStub = DurableObjectStub<QuotaTrackerObject>;
