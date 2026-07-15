export interface ArchiveOptions {
  archiveBeforeDays: number;
  bucket: string;
  createMonthsAhead: number;
  keepTemp: boolean;
  mode: "apply" | "dry-run";
  now: Date;
  purgeConfirmation?: string;
  purgeVerifiedBeforeDays?: number;
}

const DEFAULT_BUCKET = "cheatcode-audit";
const DEFAULT_ARCHIVE_BEFORE_DAYS = 90;
const DEFAULT_CREATE_MONTHS_AHEAD = 24;
const MIN_ARCHIVE_BEFORE_DAYS = 30;
const MIN_PURGE_VERIFIED_BEFORE_DAYS = 30;
const MAX_RETENTION_DAYS = 3_650;
const MAX_CREATE_MONTHS_AHEAD = 60;
const PURGE_CONFIRMATION = "DROP_VERIFIED_AUDIT_PARTITIONS";
const VALUED_OPTIONS = new Set([
  "--archive-before-days",
  "--bucket",
  "--confirm-purge",
  "--create-months-ahead",
  "--purge-verified-before-days",
]);
const BOOLEAN_OPTIONS = new Set(["--apply", "--dry-run", "--keep-temp"]);

export function parseArchiveArgs(argv: readonly string[], now = new Date()): ArchiveOptions {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  if (normalized.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (normalized.includes("--apply") && normalized.includes("--dry-run")) {
    throw new Error("Pass only one of --apply or --dry-run.");
  }
  const options = defaultArchiveOptions(now);
  applyArchiveArguments(normalized, options);
  validateArchiveOptions(options);
  return options;
}

function applyArchiveArguments(normalized: readonly string[], options: ArchiveOptions): void {
  const seen = new Set<string>();
  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (!arg) {
      continue;
    }
    const assignment = splitAssignment(arg);
    const name = assignment?.name ?? arg;
    assertOptionNotRepeated(seen, name);
    if (assignment && BOOLEAN_OPTIONS.has(name)) {
      throw new Error(`${name} does not take a value.`);
    }
    if (applyBooleanOption(options, name)) {
      continue;
    }
    if (!VALUED_OPTIONS.has(name)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = assignment?.value ?? optionValue(normalized, index, name);
    setValuedOption(options, name, value);
    if (!assignment) {
      index += 1;
    }
  }
}

function usage(): string {
  return [
    "Usage: pnpm audit:archive -- [--dry-run|--apply] [options]",
    "",
    "Options:",
    "  --archive-before-days <days>          Detach/archive partitions at least this old (minimum 30).",
    "  --bucket <name>                       R2 bucket for new archives. Defaults to cheatcode-audit.",
    "  --create-months-ahead <n>             Ensure this many future monthly partitions exist (maximum 60).",
    "  --purge-verified-before-days <days>   Drop detached DB tables verified at least this long ago (minimum 30).",
    `  --confirm-purge ${PURGE_CONFIRMATION}`,
    "                                        Required with --apply and purge; R2 archives are retained.",
    "  --keep-temp                           Keep local archive/verification files after an apply run.",
  ].join("\n");
}

function defaultArchiveOptions(now: Date): ArchiveOptions {
  return {
    archiveBeforeDays: DEFAULT_ARCHIVE_BEFORE_DAYS,
    bucket: DEFAULT_BUCKET,
    createMonthsAhead: DEFAULT_CREATE_MONTHS_AHEAD,
    keepTemp: false,
    mode: "dry-run",
    now,
  };
}

function assertOptionNotRepeated(seen: Set<string>, name: string): void {
  if (seen.has(name)) {
    throw new Error(`Pass ${name} only once.`);
  }
  seen.add(name);
}

function splitAssignment(arg: string): { name: string; value: string } | undefined {
  const separatorIndex = arg.indexOf("=");
  return separatorIndex === -1
    ? undefined
    : { name: arg.slice(0, separatorIndex), value: arg.slice(separatorIndex + 1) };
}

function optionValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function applyBooleanOption(options: ArchiveOptions, arg: string): boolean {
  if (arg === "--apply" || arg === "--dry-run") {
    options.mode = arg === "--apply" ? "apply" : "dry-run";
    return true;
  }
  if (arg === "--keep-temp") {
    options.keepTemp = true;
    return true;
  }
  return false;
}

function setValuedOption(options: ArchiveOptions, name: string, value: string): void {
  switch (name) {
    case "--archive-before-days":
      options.archiveBeforeDays = boundedInteger(
        value,
        name,
        MIN_ARCHIVE_BEFORE_DAYS,
        MAX_RETENTION_DAYS,
      );
      return;
    case "--bucket":
      options.bucket = value;
      return;
    case "--confirm-purge":
      options.purgeConfirmation = value;
      return;
    case "--create-months-ahead":
      options.createMonthsAhead = boundedInteger(value, name, 1, MAX_CREATE_MONTHS_AHEAD);
      return;
    case "--purge-verified-before-days":
      options.purgeVerifiedBeforeDays = boundedInteger(
        value,
        name,
        MIN_PURGE_VERIFIED_BEFORE_DAYS,
        MAX_RETENTION_DAYS,
      );
      return;
    default:
      throw new Error(`Unknown argument: ${name}`);
  }
}

function boundedInteger(raw: string, name: string, minimum: number, maximum: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function validateArchiveOptions(options: ArchiveOptions): void {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket)) {
    throw new Error("--bucket must be a valid R2 bucket name.");
  }
  if (Number.isNaN(options.now.getTime())) {
    throw new Error("Archive clock is invalid.");
  }
  if (options.keepTemp && options.mode !== "apply") {
    throw new Error("--keep-temp is valid only with --apply.");
  }
  if (options.purgeConfirmation && options.purgeVerifiedBeforeDays === undefined) {
    throw new Error("--confirm-purge requires --purge-verified-before-days.");
  }
  if (
    options.mode === "apply" &&
    options.purgeVerifiedBeforeDays !== undefined &&
    options.purgeConfirmation !== PURGE_CONFIRMATION
  ) {
    throw new Error(`Purging requires --confirm-purge ${PURGE_CONFIRMATION}.`);
  }
}
