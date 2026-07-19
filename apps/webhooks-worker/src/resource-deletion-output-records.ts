import type { ProjectDeletionOutputRecord } from "@cheatcode/db";

export interface ResourceDeletionOutputWireRecord {
  id: string;
  recordType: "generated-output" | "upload-intent";
  r2Key: string;
}

export function outputToWireRecord(
  output: ProjectDeletionOutputRecord,
): ResourceDeletionOutputWireRecord {
  return output;
}

export function outputFromWireRecord(
  output: ResourceDeletionOutputWireRecord,
): ProjectDeletionOutputRecord {
  return output;
}
