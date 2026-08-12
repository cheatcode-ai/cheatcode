import { APIError } from "@cheatcode/observability";
import { CONTEXT } from "../context";
import { requestContextFromToolContext } from "./tool-runtime-context";

const APP_BUILDER_MODES = new Set(["app-builder", "app-builder-mobile"]);
const DIRECT_SCAFFOLD_COMMANDS = new Set(["create", "init"]);
const PACKAGE_RUNNERS = new Set(["bunx", "npx", "pnpx"]);
const SCAFFOLD_EXECUTABLE = /^(?:create(?:-[a-z0-9@._/-]+)?|create-next-app)$/u;
const SHELL_SCAFFOLD_COMMAND =
  /(?:^|&&|\|\||;|\n|\()\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+)\s+)*(?:command\s+)?(?:sudo\s+)?(?:corepack\s+)?(?:(?:npm|pnpm|yarn|bun)\s+(?:create|init)\b|(?:npx|pnpx|bunx)\s+(?:--[a-z-]+(?:=[^\s]+)?\s+)*(?:create(?:-[^\s;&|()]+)?|create-next-app|expo\s+init)\b|pnpm\s+(?:dlx|exec)\s+(?:--[a-z-]+(?:=[^\s]+)?\s+)*(?:create(?:-[^\s;&|()]+)?|create-next-app|expo\s+init)\b)/iu;
const MANAGED_PREVIEW_START_COMMAND =
  /(?:^|&&|\|\||;|\n|\()\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+)\s+)*(?:command\s+)?(?:sudo\s+)?(?:corepack\s+)?(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|web)\b|(?:npx|pnpx|bunx|pnpm\s+(?:dlx|exec))\s+(?:--[a-z-]+(?:=[^\s]+)?\s+)*(?:expo\s+start|next\s+dev|vite)\b|(?:expo\s+start|next\s+dev|vite)(?:\s|$))/iu;
const MANAGED_DEPENDENCY_REINSTALL =
  /(?:^|&&|\|\||;|\n|\()\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+)\s+)*(?:command\s+)?(?:sudo\s+)?(?:corepack\s+)?(?:npm|pnpm|bun)\s+install\b|(?:^|&&|\|\||;|\n|\()\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+)\s+)*(?:command\s+)?(?:sudo\s+)?(?:corepack\s+)?yarn(?:\s|$)/iu;
const MANAGED_NON_PNPM_COMMAND =
  /(?:^|&&|\|\||;|\n|\()\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|()]+)\s+)*(?:command\s+)?(?:sudo\s+)?(?:corepack\s+)?(?:npm|npx|pnpx|yarn|bun|bunx)\b/iu;

/** Prevents model-authored scaffolds from replacing the prepared app-builder workspace. */
export function assertAppBuilderShellCommandAllowed(
  context: unknown,
  command: readonly string[] | string,
): void {
  const requestContext = requestContextFromToolContext(context);
  const projectMode = requestContext.get(CONTEXT.promptProjectMode);
  if (typeof projectMode !== "string" || !APP_BUILDER_MODES.has(projectMode)) return;
  if (isScaffoldCommand(command)) {
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
  if (requestContext.get(CONTEXT.appBuilderManagedPreview) !== true) return;
  if (isManagedPreviewStartCommand(command)) {
    throw new APIError(
      422,
      "tool_validation_failed",
      "This app's managed preview is already running.",
      {
        hint: "Edit the existing source files and verify the running preview in the browser.",
        retriable: false,
      },
    );
  }
  if (usesNonPnpmPackageManager(command)) {
    throw new APIError(422, "tool_validation_failed", "This managed app uses pnpm.", {
      hint: "Use pnpm for an explicit dependency change. The existing dependencies are already installed.",
      retriable: false,
    });
  }
  if (!isManagedDependencyReinstall(command)) return;
  throw new APIError(
    422,
    "tool_validation_failed",
    "This managed app's dependencies are already installed.",
    {
      hint: "Continue editing. Use pnpm add or pnpm remove only when the app needs a dependency change.",
      retriable: false,
    },
  );
}

/** Prevents a stale or unadvertised dev-server call from replacing a managed template preview. */
export function assertManagedAppDevServerStartAllowed(context: unknown): void {
  const requestContext = requestContextFromToolContext(context);
  if (requestContext.get(CONTEXT.appBuilderManagedPreview) !== true) return;
  throw new APIError(
    422,
    "tool_validation_failed",
    "This app's managed preview is already running.",
    {
      hint: "Edit the existing source files and verify the running preview in the browser.",
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

function isManagedPreviewStartCommand(command: readonly string[] | string): boolean {
  if (typeof command === "string") return MANAGED_PREVIEW_START_COMMAND.test(command);
  const normalized = unwrapCommand(command.map((argument) => argument.toLowerCase()));
  const executable = basename(normalized[0]);
  const args = normalized.slice(1).filter((argument) => !argument.startsWith("-"));
  if (["bun", "npm", "pnpm", "yarn"].includes(executable)) {
    const commandName = args[0] === "run" ? args[1] : args[0];
    if (["dev", "start", "web"].includes(commandName ?? "")) return true;
    if (executable === "pnpm" && ["dlx", "exec"].includes(args[0] ?? "")) {
      return runnerStartsPreview(args.slice(1));
    }
    return false;
  }
  if (PACKAGE_RUNNERS.has(executable)) return runnerStartsPreview(args);
  return runnerStartsPreview([executable, ...args]);
}

function isManagedDependencyReinstall(command: readonly string[] | string): boolean {
  if (typeof command === "string") return MANAGED_DEPENDENCY_REINSTALL.test(command);
  const normalized = unwrapCommand(command.map((argument) => argument.toLowerCase()));
  const executable = basename(normalized[0]);
  const commandName = normalized.slice(1).find((argument) => !argument.startsWith("-"));
  return (
    executable === "yarn" ||
    (["bun", "npm", "pnpm"].includes(executable) && commandName === "install")
  );
}

function usesNonPnpmPackageManager(command: readonly string[] | string): boolean {
  if (typeof command === "string") return MANAGED_NON_PNPM_COMMAND.test(command);
  const executable = basename(unwrapCommand(command.map((argument) => argument.toLowerCase()))[0]);
  return ["bun", "bunx", "npm", "npx", "pnpx", "yarn"].includes(executable);
}

function runnerStartsPreview(args: readonly string[]): boolean {
  const executableIndex = args.findIndex((argument) => !argument.startsWith("-"));
  const executable = args[executableIndex];
  const command = args.slice(executableIndex + 1).find((argument) => !argument.startsWith("-"));
  return (
    executable === "vite" ||
    (executable === "next" && command === "dev") ||
    (executable === "expo" && command === "start")
  );
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
