import type { ProjectDeletionOutputRecord } from "@cheatcode/db";

export interface ResourceDeletionOutputWire {
  id: string;
  recordType: "generated-output" | "upload-intent";
  r2Key: string;
}

export function outputToWireRecord(
  output: ProjectDeletionOutputRecord,
): ResourceDeletionOutputWire {
  return output;
}

export function outputFromWireRecord(
  output: ResourceDeletionOutputWire,
): ProjectDeletionOutputRecord {
  return output;
}
