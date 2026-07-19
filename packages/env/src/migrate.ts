import { existsSync, readFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { z } from "zod";

const DEFAULT_ENV_FILES = [".env.local"] as const;
const OptionalMigrationAttestationsSchema = z.preprocess(
  (value) => (typeof value === "string" && !value.trim() ? undefined : value),
  z.string().trim().min(2).max(65_536).optional(),
);

const MigrationEnvSchema = z
  .object({
    CHEATCODE_LOCAL_DATABASE: z.enum(["true", "false"]).default("false"),
    CHEATCODE_MIGRATION_ATTESTATIONS: OptionalMigrationAttestationsSchema,
    SUPABASE_MIGRATION_EXPECTED_DATABASE: z.string().trim().min(1).optional(),
    SUPABASE_MIGRATION_EXPECTED_HOST: z.string().trim().min(1).optional(),
    SUPABASE_MIGRATION_EXPECTED_ROLE: z.string().trim().min(1).optional(),
    SUPABASE_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: z.string().regex(/^\d+$/).optional(),
    SUPABASE_MIGRATION_URL: z.string().url(),
  })
  .passthrough();

export interface MigrationEnv {
  databaseUrl: string;
  expectedDatabase?: string;
  expectedHost?: string;
  expectedRole?: string;
  expectedSystemIdentifier?: string;
  isLocalDatabase: boolean;
  migrationAttestations?: string;
}

function parseMigrationEnv(env: unknown): MigrationEnv {
  const parsed = MigrationEnvSchema.parse(env);
  return {
    databaseUrl: parsed.SUPABASE_MIGRATION_URL,
    isLocalDatabase: parsed.CHEATCODE_LOCAL_DATABASE === "true",
    ...(parsed.CHEATCODE_MIGRATION_ATTESTATIONS
      ? { migrationAttestations: parsed.CHEATCODE_MIGRATION_ATTESTATIONS }
      : {}),
    ...(parsed.SUPABASE_MIGRATION_EXPECTED_DATABASE
      ? { expectedDatabase: parsed.SUPABASE_MIGRATION_EXPECTED_DATABASE }
      : {}),
    ...(parsed.SUPABASE_MIGRATION_EXPECTED_HOST
      ? { expectedHost: parsed.SUPABASE_MIGRATION_EXPECTED_HOST }
      : {}),
    ...(parsed.SUPABASE_MIGRATION_EXPECTED_ROLE
      ? { expectedRole: parsed.SUPABASE_MIGRATION_EXPECTED_ROLE }
      : {}),
    ...(parsed.SUPABASE_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER
      ? { expectedSystemIdentifier: parsed.SUPABASE_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER }
      : {}),
  };
}

export function loadMigrationEnv(root = findWorkspaceRoot(process.cwd())): MigrationEnv {
  return loadMigrationEnvFromFiles(root);
}

export function loadMigrationEnvFromFiles(root: string): MigrationEnv {
  return parseMigrationEnv({
    ...loadEnvFiles(root),
    ...process.env,
  });
}

function loadEnvFiles(root: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const envFile of DEFAULT_ENV_FILES) {
    const filePath = resolve(root, envFile);
    if (existsSync(filePath)) {
      Object.assign(values, parseEnvFile(filePath));
    }
  }
  return values;
}

function parseEnvFile(filePath: string): Record<string, string> {
  const values: Record<string, string> = {};
  const content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const delimiterIndex = normalized.indexOf("=");
    if (delimiterIndex === -1) {
      continue;
    }
    const key = normalized.slice(0, delimiterIndex).trim();
    if (/^[A-Z0-9_]+$/.test(key)) {
      values[key] = unquote(normalized.slice(delimiterIndex + 1));
    }
  }
  return values;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const quote = trimmed[0];
  const last = trimmed.at(-1);
  if ((quote !== '"' && quote !== "'" && quote !== "`") || quote !== last) {
    return trimmed;
  }

  const inner = trimmed.slice(1, -1);
  if (quote !== '"') {
    return inner;
  }

  return inner
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t")
    .replaceAll('\\"', '"')
    .replaceAll("\\\\", "\\");
}

function findWorkspaceRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) {
      return start;
    }
    current = parent;
  }
}
