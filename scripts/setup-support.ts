import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  parseEnvFile,
  parseSupabaseProjectRef,
  validateSupabasePoolerHost,
} from "./local-env-contract";

export interface AdminDatabaseTarget {
  database: string;
  hostname: string;
  projectRef: string;
  role: string;
  url: string;
}

export interface MigrationEnvironment {
  SUPABASE_MIGRATION_EXPECTED_DATABASE: string;
  SUPABASE_MIGRATION_EXPECTED_HOST: string;
  SUPABASE_MIGRATION_EXPECTED_ROLE: string;
  SUPABASE_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: string;
  SUPABASE_MIGRATION_URL: string;
}

interface PackageContract {
  engines: { node: string };
  packageManager: string;
}

interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

const LOCAL_PORTS = [3001, 8787, 9239] as const;

export async function runSetupPreflight(root: string): Promise<void> {
  const contract = await readPackageContract(root);
  if (process.version !== `v${contract.engines.node}`) {
    throw new Error(
      `Node preflight failed: expected v${contract.engines.node}, got ${process.version}.`,
    );
  }
  const expectedPnpm = contract.packageManager.replace(/^pnpm@/u, "");
  await assertCommandVersion("pnpm", ["--version"], expectedPnpm, "pnpm");
  await assertSuccessfulCommand("docker", ["compose", "version"], "Docker Compose");
  await assertSuccessfulCommand("docker", ["info"], "Docker daemon");
  const isStackRunning = await existingStackIsRunning(root);
  if (!isStackRunning) {
    await Promise.all(LOCAL_PORTS.map(assertPortAvailable));
  }
}

export function parseAdminDatabaseUrl(
  raw: string,
  expectedProjectRef: string,
): AdminDatabaseTarget {
  const url = parseDatabaseUrl(raw, "Supabase admin connection string");
  const username = decodeComponent(url.username, "Supabase admin username");
  const directRef = directAdminProjectRef(url.hostname);
  const poolerRef = poolerAdminProjectRef(url.hostname, username);
  const isDirect = directRef === expectedProjectRef && username === "postgres";
  const isPooler = poolerRef === expectedProjectRef;
  const isValid =
    Boolean(url.password) &&
    url.port === "5432" &&
    url.pathname === "/postgres" &&
    url.searchParams.get("sslmode") === "require" &&
    !url.hash &&
    (isDirect || isPooler);
  if (!isValid) {
    throw new Error(
      "Admin connection must use postgres on the matching Supabase direct or session-pooler endpoint at port 5432 with sslmode=require.",
    );
  }
  return {
    database: "postgres",
    hostname: url.hostname,
    projectRef: expectedProjectRef,
    role: "postgres",
    url: raw,
  };
}

export function migrationEnvironment(
  target: AdminDatabaseTarget,
  systemIdentifier: string,
): MigrationEnvironment {
  return {
    SUPABASE_MIGRATION_EXPECTED_DATABASE: target.database,
    SUPABASE_MIGRATION_EXPECTED_HOST: target.hostname,
    SUPABASE_MIGRATION_EXPECTED_ROLE: target.role,
    SUPABASE_MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: systemIdentifier,
    SUPABASE_MIGRATION_URL: target.url,
  };
}

export function sanitizedMigrationChildEnvironment(
  values: MigrationEnvironment,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("SUPABASE_MIGRATION_") && value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...values };
}

export async function runInheritedCommand(
  command: string,
  args: readonly string[],
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });
}

export async function readOptionalEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(filePath, "utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeEnvFileAtomic(
  filePath: string,
  values: Record<string, string>,
  order: readonly string[],
  header: readonly string[],
): Promise<void> {
  const content = serializeEnv(values, order, header);
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(temporaryPath, content, { flag: "wx", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function assertSafeEnvValue(key: string, value: string): void {
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new Error(`${key} contains a control character; paste a single-line value.`);
  }
  // Values are written bare so the same line round-trips identically through
  // this wizard's reader, wrangler --env-file, and docker compose --env-file
  // (compose treats quotes as literal characters). Shapes a bare line cannot
  // represent are rejected instead of quoted.
  if (value !== value.trim()) {
    throw new Error(`${key} has leading or trailing whitespace; remove it.`);
  }
  if (value.startsWith('"') || value.startsWith("'")) {
    throw new Error(`${key} must not start with a quote character.`);
  }
  if (value.includes("#")) {
    throw new Error(
      `${key} contains '#', which dotenv parsers read as a comment start; this value cannot be represented.`,
    );
  }
  if (value.includes("$")) {
    throw new Error(
      `${key} contains '$', which wrangler's env-file expansion substitutes with host variables; this value cannot be represented.`,
    );
  }
}

export async function pollLocalReadiness(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await localEndpointsAreReady()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error("Local stack readiness timed out after 120 seconds.");
}

function serializeEnv(
  values: Record<string, string>,
  order: readonly string[],
  header: readonly string[],
): string {
  for (const [key, value] of Object.entries(values)) {
    assertSafeEnvValue(key, value);
  }
  const known = new Set(order);
  const keys = [...order.filter((key) => values[key] !== undefined)];
  keys.push(
    ...Object.keys(values)
      .filter((key) => !known.has(key))
      .sort(),
  );
  return `${header.map((line) => `# ${line}`).join("\n")}\n${keys
    .map((key) => `${key}=${values[key] ?? ""}`)
    .join("\n")}\n`;
}

async function readPackageContract(root: string): Promise<PackageContract> {
  const parsed: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed["engines"])) {
    throw new Error("Toolchain preflight could not read package.json engines.");
  }
  const node = parsed["engines"]["node"];
  const packageManager = parsed["packageManager"];
  if (typeof node !== "string" || typeof packageManager !== "string") {
    throw new Error("Toolchain preflight found an invalid package.json contract.");
  }
  return { engines: { node }, packageManager };
}

async function assertCommandVersion(
  command: string,
  args: readonly string[],
  expected: string,
  label: string,
): Promise<void> {
  const result = await captureCommand(command, args);
  const actual = result.stdout.trim();
  if (result.code !== 0 || actual !== expected) {
    throw new Error(
      `${label} preflight failed: expected ${expected}, got ${actual || "unavailable"}.`,
    );
  }
}

async function assertSuccessfulCommand(
  command: string,
  args: readonly string[],
  label: string,
): Promise<void> {
  const result = await captureCommand(command, args);
  if (result.code !== 0) {
    throw new Error(`${label} preflight failed: ${result.stderr.trim() || "command failed"}.`);
  }
}

function captureCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr, stdout }));
  });
}

async function existingStackIsRunning(root: string): Promise<boolean> {
  const localEnv = join(root, ".env.local");
  const result = await captureCommand("docker", [
    "compose",
    "--env-file",
    localEnv,
    "ps",
    "--status",
    "running",
    "-q",
    "app",
  ]).catch(() => undefined);
  return Boolean(result?.stdout.trim());
}

function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", () =>
      reject(new Error(`Port preflight failed: 127.0.0.1:${port} is busy.`)),
    );
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePromise()));
  });
}

async function localEndpointsAreReady(): Promise<boolean> {
  try {
    const request = { signal: AbortSignal.timeout(2_000) };
    const [web, gateway] = await Promise.all([
      fetch("http://127.0.0.1:3001/cheatcode-symbol.png", request),
      fetch("http://127.0.0.1:8787/health/live", request),
    ]);
    const body: unknown = await gateway.json();
    return (
      web.ok &&
      web.headers.get("content-type")?.startsWith("image/png") === true &&
      gateway.ok &&
      isRecord(body) &&
      body["ok"] === true
    );
  } catch {
    return false;
  }
}

function parseDatabaseUrl(raw: string, label: string): URL {
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("invalid protocol");
    }
    return url;
  } catch {
    throw new Error(`${label} must be a PostgreSQL connection URL.`);
  }
}

function decodeComponent(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} must be valid URL-encoded text.`);
  }
}

function isSupabasePoolerHost(hostname: string): boolean {
  try {
    validateSupabasePoolerHost(hostname);
    return true;
  } catch {
    return false;
  }
}

function directAdminProjectRef(hostname: string): string | undefined {
  const match = /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(hostname);
  if (!match?.[1]) {
    return undefined;
  }
  return parseSupabaseProjectRef(match[1], "Admin URL project ref");
}

function poolerAdminProjectRef(hostname: string, username: string): string | undefined {
  if (!isSupabasePoolerHost(hostname) || !username.startsWith("postgres.")) {
    return undefined;
  }
  return parseSupabaseProjectRef(username.slice("postgres.".length), "Admin URL project ref");
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error["code"] === "string" ? error["code"] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
