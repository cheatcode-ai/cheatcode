import { loadMigrationEnv } from "@cheatcode/env/migrate";
import { defineConfig } from "drizzle-kit";

const migrationEnv = loadMigrationEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/drizzle.ts",
  out: "./drizzle",
  dbCredentials: {
    url: migrationEnv.databaseUrl,
  },
  tablesFilter: ["!audit_log", "!v2_audit_log"],
  strict: true,
  verbose: true,
});
