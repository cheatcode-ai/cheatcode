import { APIError } from "@cheatcode/observability";
import type {
  SandboxDeleteFileInput,
  SandboxExecInput,
  SandboxKillProcessInput,
  SandboxLike,
  SandboxListFilesInput,
  SandboxReadFileInput,
  SandboxRunCodeInput,
  SandboxRunCodeResult,
  SandboxSearchFilesInput,
  SandboxStartProcessInput,
  SandboxWriteFileInput,
} from "./runtime";

type SandboxMethodName =
  | "deleteFile"
  | "exec"
  | "killProcess"
  | "listFiles"
  | "readFile"
  | "runCode"
  | "searchFiles"
  | "startProcess"
  | "writeFile";

type SandboxMethodInput = {
  deleteFile: SandboxDeleteFileInput;
  exec: SandboxExecInput;
  killProcess: SandboxKillProcessInput;
  listFiles: SandboxListFilesInput;
  readFile: SandboxReadFileInput;
  runCode: SandboxRunCodeInput;
  searchFiles: SandboxSearchFilesInput;
  startProcess: SandboxStartProcessInput;
  writeFile: SandboxWriteFileInput;
};

type SandboxMethodOutput = {
  deleteFile: Awaited<ReturnType<NonNullable<SandboxLike["deleteFile"]>>>;
  exec: Awaited<ReturnType<NonNullable<SandboxLike["exec"]>>>;
  killProcess: Awaited<ReturnType<NonNullable<SandboxLike["killProcess"]>>>;
  listFiles: Awaited<ReturnType<NonNullable<SandboxLike["listFiles"]>>>;
  readFile: Awaited<ReturnType<NonNullable<SandboxLike["readFile"]>>>;
  runCode: SandboxRunCodeResult;
  searchFiles: Awaited<ReturnType<NonNullable<SandboxLike["searchFiles"]>>>;
  startProcess: Awaited<ReturnType<NonNullable<SandboxLike["startProcess"]>>>;
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
      hint: "Update the ProjectSandbox Durable Object before using this tool.",
      retriable: false,
    });
  }
  const typedMethod = method as (
    value: SandboxMethodInput[Name],
  ) => Promise<SandboxMethodOutput[Name]>;
  return typedMethod(input);
}
