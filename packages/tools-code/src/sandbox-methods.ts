import { APIError } from "@cheatcode/observability";
import type {
  SandboxCreateBackupInput,
  SandboxDeleteFileInput,
  SandboxExecInput,
  SandboxExposePortInput,
  SandboxKillProcessInput,
  SandboxLike,
  SandboxListFilesInput,
  SandboxReadFileInput,
  SandboxRestoreBackupInput,
  SandboxRunCodeResult,
  SandboxSearchFilesInput,
  SandboxStartProcessInput,
  SandboxUnexposePortInput,
  SandboxWriteFileInput,
} from "./runtime";

type SandboxMethodName =
  | "createBackup"
  | "deleteFile"
  | "exec"
  | "exposePort"
  | "killProcess"
  | "listFiles"
  | "readFile"
  | "restoreBackup"
  | "runCode"
  | "searchFiles"
  | "startProcess"
  | "unexposePort"
  | "writeFile";

type SandboxMethodInput = {
  createBackup: SandboxCreateBackupInput;
  deleteFile: SandboxDeleteFileInput;
  exec: SandboxExecInput;
  exposePort: SandboxExposePortInput;
  killProcess: SandboxKillProcessInput;
  listFiles: SandboxListFilesInput;
  readFile: SandboxReadFileInput;
  restoreBackup: SandboxRestoreBackupInput;
  runCode: Parameters<SandboxLike["runCode"]>[0];
  searchFiles: SandboxSearchFilesInput;
  startProcess: SandboxStartProcessInput;
  unexposePort: SandboxUnexposePortInput;
  writeFile: SandboxWriteFileInput;
};

type SandboxMethodOutput = {
  createBackup: Awaited<ReturnType<NonNullable<SandboxLike["createBackup"]>>>;
  deleteFile: Awaited<ReturnType<NonNullable<SandboxLike["deleteFile"]>>>;
  exec: Awaited<ReturnType<NonNullable<SandboxLike["exec"]>>>;
  exposePort: Awaited<ReturnType<NonNullable<SandboxLike["exposePort"]>>>;
  killProcess: Awaited<ReturnType<NonNullable<SandboxLike["killProcess"]>>>;
  listFiles: Awaited<ReturnType<NonNullable<SandboxLike["listFiles"]>>>;
  readFile: Awaited<ReturnType<NonNullable<SandboxLike["readFile"]>>>;
  restoreBackup: Awaited<ReturnType<NonNullable<SandboxLike["restoreBackup"]>>>;
  runCode: SandboxRunCodeResult;
  searchFiles: Awaited<ReturnType<NonNullable<SandboxLike["searchFiles"]>>>;
  startProcess: Awaited<ReturnType<NonNullable<SandboxLike["startProcess"]>>>;
  unexposePort: Awaited<ReturnType<NonNullable<SandboxLike["unexposePort"]>>>;
  writeFile: Awaited<ReturnType<NonNullable<SandboxLike["writeFile"]>>>;
};

export async function callSandboxMethod<Name extends SandboxMethodName>(
  sandbox: SandboxLike,
  name: Name,
  input: SandboxMethodInput[Name],
): Promise<SandboxMethodOutput[Name]> {
  const method = sandbox[name];
  if (typeof method !== "function") {
    throw new APIError(500, "validation_tool_not_registered", `Sandbox method ${name} is missing`, {
      hint: "Update the ProjectSandbox Durable Object before using this code tool.",
      retriable: false,
    });
  }
  const typedMethod = method as (
    input: SandboxMethodInput[Name],
  ) => Promise<SandboxMethodOutput[Name]>;
  return typedMethod(input);
}
