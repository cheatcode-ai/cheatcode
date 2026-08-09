import { APIError } from "@cheatcode/observability";
import { CONTEXT } from "../context";
import { requestContextFromToolContext } from "./tool-runtime-context";

const APP_BUILDER_MODES = new Set(["app-builder", "app-builder-mobile"]);
const DIRECT_SCAFFOLD_COMMANDS = new Set(["create", "init"]);
const PACKAGE_RUNNERS = new Set(["bunx", "npx", "pnpx"]);
const SCAFFOLD_EXECUTABLE = /^(?:create(?:-[a-z0-9@._/-]+)?|create-next-app)$/u;
const SHELL_SCAFFOLD_COMMAND =
  /(?:^|&&|\|\||;|\n|\()\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+)\s+)*(?:command\s+)?(?:sudo\s+)?(?:corepack\s+)?(?:(?:npm|pnpm|yarn|bun)\s+(?:create|init)\b|(?:npx|pnpx|bunx)\s+(?:--[a-z-]+(?:=[^\s]+)?\s+)*(?:create(?:-[^\s;&|()]+)?|create-next-app|expo\s+init)\b|pnpm\s+(?:dlx|exec)\s+(?:--[a-z-]+(?:=[^\s]+)?\s+)*(?:create(?:-[^\s;&|()]+)?|create-next-app|expo\s+init)\b)/iu;

/** Prevents model-authored scaffolds from replacing the prepared app-builder workspace. */
export function assertAppBuilderShellCommandAllowed(
  context: unknown,
  command: readonly string[] | string,
): void {
  const requestContext = requestContextFromToolContext(context);
  const projectMode = requestContext.get(CONTEXT.promptProjectMode);
  if (typeof projectMode !== "string" || !APP_BUILDER_MODES.has(projectMode)) return;
  if (!isScaffoldCommand(command)) return;
  throw new APIError(
    422,
    "tool_validation_failed",
    "This app workspace is already scaffolded at the project root.",
    {
      hint: "Inspect and edit the existing root files. Do not initialize another app or nested project.",
      retriable: false,
    },
  );
}

function isScaffoldCommand(command: readonly string[] | string): boolean {
  if (typeof command === "string") return SHELL_SCAFFOLD_COMMAND.test(command);
  const normalized = unwrapCommand(command.map((argument) => argument.toLowerCase()));
  const executable = basename(normalized[0]);
  const args = normalized.slice(1);
  if (["bun", "npm", "pnpm", "yarn"].includes(executable)) {
    if (DIRECT_SCAFFOLD_COMMANDS.has(args[0] ?? "")) return true;
    if (executable === "pnpm" && ["dlx", "exec"].includes(args[0] ?? "")) {
      return runnerStartsScaffold(args.slice(1));
    }
    return false;
  }
  return PACKAGE_RUNNERS.has(executable) && runnerStartsScaffold(args);
}

function unwrapCommand(command: readonly string[]): readonly string[] {
  let offset = 0;
  while (command[offset] === "env" || command[offset] === "sudo") {
    offset += 1;
    while (
      command[offset] === "--" ||
      command[offset]?.startsWith("-") ||
      /^[A-Za-z_][A-Za-z0-9_]*=/u.test(command[offset] ?? "")
    ) {
      offset += 1;
    }
  }
  if (command[offset] === "corepack") offset += 1;
  return command.slice(offset);
}

function runnerStartsScaffold(args: readonly string[]): boolean {
  const executableIndex = args.findIndex((argument) => !argument.startsWith("-"));
  const executable = args[executableIndex];
  if (SCAFFOLD_EXECUTABLE.test(executable ?? "")) return true;
  if (executable !== "expo") return false;
  return args.slice(executableIndex + 1).find((argument) => !argument.startsWith("-")) === "init";
}

function basename(path: string | undefined): string {
  if (!path) return "";
  return path.slice(path.lastIndexOf("/") + 1);
}
