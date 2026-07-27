import { loadMigrationEnv } from "@cheatcode/env/migrate";
import { defineConfig } from "drizzle-kit";

const migrationEnv = loadMigrationEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: migrationEnv.databaseUrl,
  },
  strict: true,
  verbose: true,
});
