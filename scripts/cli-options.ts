export interface ParsedOption {
  name: string;
  nextIndex: number;
  value?: string;
}

export interface ParsedValue {
  nextIndex: number;
  value: string;
}

type ReleaseDrainGate = "closed" | "draining";

export interface ReleaseDrainOptions {
  releaseGate: ReleaseDrainGate;
  releaseSha: string;
}

interface PartialReleaseDrainOptions {
  releaseGate?: ReleaseDrainGate;
  releaseSha?: string;
}

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function parseReleaseDrainOptions(
  argv: readonly string[],
  onHelp?: () => never,
): ReleaseDrainOptions {
  const state: PartialReleaseDrainOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = readOption(argv, index);
    if (option.name === "--") continue;
    if ((option.name === "--help" || option.name === "-h") && onHelp) {
      onHelp();
    }
    index = applyReleaseDrainOption(argv, index, option, state);
  }
  return completeReleaseDrainOptions(state);
}

function applyReleaseDrainOption(
  argv: readonly string[],
  index: number,
  option: ParsedOption,
  state: PartialReleaseDrainOptions,
): number {
  if (option.name === "--release-gate" && state.releaseGate === undefined) {
    const parsed = readRequiredOptionValue(argv, index, option, "closed or draining.");
    state.releaseGate = parseReleaseDrainGate(parsed.value);
    return parsed.nextIndex;
  }
  if (option.name === "--release-sha" && state.releaseSha === undefined) {
    const parsed = readRequiredOptionValue(argv, index, option, "a full Git commit SHA.");
    state.releaseSha = parsed.value;
    return parsed.nextIndex;
  }
  throw new Error(`Unknown or repeated argument: ${option.name}`);
}

function parseReleaseDrainGate(value: string): ReleaseDrainGate {
  if (value !== "closed" && value !== "draining") {
    throw new Error("--release-gate must be closed or draining.");
  }
  return value;
}

function completeReleaseDrainOptions(state: PartialReleaseDrainOptions): ReleaseDrainOptions {
  if (!state.releaseSha || !RELEASE_SHA_PATTERN.test(state.releaseSha)) {
    throw new Error("--release-sha must be a full lowercase 40-character Git commit SHA.");
  }
  if (!state.releaseGate) {
    throw new Error("--release-gate must be closed or draining.");
  }
  return { releaseGate: state.releaseGate, releaseSha: state.releaseSha };
}

export function readOption(argv: readonly string[], index: number): ParsedOption {
  const arg = argv[index];
  if (!arg) {
    throw new Error(`Missing argument at index ${index}.`);
  }
  if (arg === "--") {
    return { name: "--", nextIndex: index };
  }
  const equalsIndex = arg.indexOf("=");
  if (arg.startsWith("--") && equalsIndex > 0) {
    return {
      name: arg.slice(0, equalsIndex),
      nextIndex: index,
      value: arg.slice(equalsIndex + 1),
    };
  }
  return { name: arg, nextIndex: index };
}

export function readRequiredOptionValue(
  argv: readonly string[],
  index: number,
  option: ParsedOption,
  description: string,
): ParsedValue {
  if (option.value !== undefined) {
    if (option.value.length === 0) {
      throw new Error(`${option.name} requires ${description}.`);
    }
    return { nextIndex: index, value: option.value };
  }

  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${option.name} requires ${description}.`);
  }
  return { nextIndex: index + 1, value };
}
