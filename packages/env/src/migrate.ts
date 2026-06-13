import { existsSync, readFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { z } from "zod";

const DEFAULT_ENV_FILES = [".env.migrate", ".env.local"] as const;

const MigrationEnvSchema = z
  .object({
    DATABASE_URL: z.string().url().optional(),
    SUPABASE_MIGRATION_URL: z.string().url().optional(),
  })
  .passthrough();

export interface MigrationEnv {
  databaseUrl: string;
}

export function parseMigrationEnv(env: unknown): MigrationEnv {
  const parsed = MigrationEnvSchema.parse(env);
  const databaseUrl = parsed.SUPABASE_MIGRATION_URL ?? parsed.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set SUPABASE_MIGRATION_URL or DATABASE_URL before running migrations.");
  }
  return { databaseUrl };
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
