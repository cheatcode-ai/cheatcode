import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ConfigRecord, isRecord, parseJsoncObject } from "./jsonc";
import {
  validateSupabaseRuntimeDatabaseUrls,
  validateSupabaseSessionPoolerUrl,
} from "./local-env-contract";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY_WORKER_DIR = join(ROOT, "apps/gateway-worker");

const WORKER_CONFIGS = [
  "wrangler.jsonc",
  "../agent-worker/wrangler.jsonc",
  "../webhooks-worker/wrangler.jsonc",
  "../preview-proxy/wrangler.jsonc",
] as const;

type WorkerConfig = (typeof WORKER_CONFIGS)[number];

const PRODUCTION_DATABASE_URL_BINDINGS: Partial<
  Record<WorkerConfig, { envKey: string; role: string }>
> = {
  "wrangler.jsonc": { envKey: "SUPABASE_GATEWAY_DATABASE_URL", role: "app_gateway" },
  "../agent-worker/wrangler.jsonc": {
    envKey: "SUPABASE_AGENT_DATABASE_URL",
    role: "app_agent",
  },
  "../webhooks-worker/wrangler.jsonc": {
    envKey: "SUPABASE_WEBHOOKS_DATABASE_URL",
    role: "app_webhooks",
  },
};

const LOCAL_WORKER_SECRET_BINDINGS: Record<WorkerConfig, readonly string[]> = {
  "wrangler.jsonc": [
    "CLERK_SECRET_KEY",
    "COMPOSIO_API_KEY",
    "COMPOSIO_AUTH_CONFIGS",
    "DATABASE_CONTEXT_SIGNING_SECRET_GATEWAY",
    "POLAR_ACCESS_TOKEN",
  ],
  "../agent-worker/wrangler.jsonc": [
    "COMPOSIO_API_KEY",
    "DATABASE_CONTEXT_SIGNING_SECRET_AGENT",
    "DAYTONA_API_KEY",
    "DEEPSEEK_PLATFORM_API_KEY",
    "MORPH_API_KEY",
    "OUTPUT_DOWNLOAD_SIGNING_SECRET",
    "PREVIEW_TOKEN_SECRET",
  ],
  "../webhooks-worker/wrangler.jsonc": [
    "CLERK_WEBHOOK_SIGNING_SECRET",
    "COMPOSIO_API_KEY",
    "COMPOSIO_WEBHOOK_SECRET",
    "DATABASE_CONTEXT_SIGNING_SECRET_WEBHOOKS",
    "DAYTONA_WEBHOOK_SIGNING_SECRET",
    "POLAR_ACCESS_TOKEN",
    "POLAR_WEBHOOK_SECRET",
  ],
  "../preview-proxy/wrangler.jsonc": ["DAYTONA_API_KEY", "PREVIEW_TOKEN_SECRET"],
};

const LOCAL_WORKER_VAR_BINDINGS: Record<WorkerConfig, readonly string[]> = {
  "wrangler.jsonc": ["POLAR_PRODUCT_ID_PREMIUM", "POLAR_PRODUCT_ID_PRO", "POLAR_SERVER"],
  "../agent-worker/wrangler.jsonc": [
    "DAYTONA_API_URL",
    "DAYTONA_ORG_ID",
    "DAYTONA_PREVIEW_HOST_SUFFIXES",
    "DAYTONA_SANDBOX_SNAPSHOT",
    "DAYTONA_TARGET",
    "DAYTONA_WORKSPACE_VOLUME",
  ],
  "../webhooks-worker/wrangler.jsonc": [
    "POLAR_PRODUCT_ID_PREMIUM",
    "POLAR_PRODUCT_ID_PRO",
    "POLAR_SERVER",
  ],
  "../preview-proxy/wrangler.jsonc": ["DAYTONA_API_URL", "DAYTONA_PREVIEW_HOST_SUFFIXES"],
};

export function localWorkerConfigs(webPort: string, values: Record<string, string>): string[] {
  validateSupabaseRuntimeDatabaseUrls(values);
  return WORKER_CONFIGS.map((config) => createLocalWorkerConfig(config, webPort, values));
}

export function removeLocalWorkerConfigs(): void {
  for (const configPath of WORKER_CONFIGS) {
    const absolutePath = resolve(GATEWAY_WORKER_DIR, configPath);
    rmSync(join(dirname(absolutePath), "wrangler.local-dev.generated.jsonc"), { force: true });
  }
}

function createLocalWorkerConfig(
  configPath: WorkerConfig,
  webPort: string,
  values: Record<string, string>,
): string {
  const absolutePath = resolve(GATEWAY_WORKER_DIR, configPath);
  const parsed = parseJsoncObject(readFileSync(absolutePath, "utf8"), configPath);
  const { secrets_store_secrets: _secretsStoreSecrets, ...localConfig } = parsed;
  const envBindings = LOCAL_WORKER_SECRET_BINDINGS[configPath].filter((key) => values[key]);
  const localDevConfig = {
    ...applyLocalWorkerOverrides(configPath, localConfig, webPort, values),
    secrets: { required: envBindings },
  };

  const outputDir = dirname(absolutePath);
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "wrangler.local-dev.generated.jsonc");
  writeFileSync(outputPath, `${JSON.stringify(localDevConfig, null, 2)}\n`, { mode: 0o600 });
  chmodSync(outputPath, 0o600);
  return relative(GATEWAY_WORKER_DIR, outputPath);
}

function applyLocalWorkerOverrides(
  configPath: WorkerConfig,
  config: ConfigRecord,
  webPort: string,
  values: Record<string, string>,
): ConfigRecord {
  const configWithLocalDatabase = withLocalHyperdrive(configPath, config, values);
  const existingVars = productionVarsRemovedForLocal(
    configPath,
    isRecord(configWithLocalDatabase["vars"]) ? configWithLocalDatabase["vars"] : {},
  );
  const localVars = {
    ...existingVars,
    ...configuredLocalVars(configPath, values),
    CHEATCODE_ENVIRONMENT: "development",
  };
  if (configPath === "wrangler.jsonc") {
    return {
      ...configWithLocalDatabase,
      services: localGatewayServices(configWithLocalDatabase),
      vars: {
        ...localVars,
        CLERK_AUTHORIZED_PARTIES: localClerkAuthorizedParties(webPort),
      },
    };
  }
  if (configPath === "../preview-proxy/wrangler.jsonc") {
    return {
      ...configWithLocalDatabase,
      vars: {
        ...localVars,
        CHEATCODE_APP_ORIGIN: `http://localhost:${webPort}`,
        PREVIEW_HOSTNAME: "localhost",
      },
    };
  }
  if (configPath !== "../agent-worker/wrangler.jsonc") {
    return { ...configWithLocalDatabase, vars: localVars };
  }
  return {
    ...configWithLocalDatabase,
    vars: {
      ...localVars,
      OUTPUT_DOWNLOAD_BASE_URL: "http://127.0.0.1:8787",
      PREVIEW_HOSTNAME: "localhost:8787",
    },
  };
}

function localGatewayServices(config: ConfigRecord): ConfigRecord[] {
  const services = config["services"];
  if (!Array.isArray(services)) {
    throw new Error("apps/gateway-worker/wrangler.jsonc has invalid service bindings.");
  }
  const parsedServices = services.map((service, index) => {
    if (!isRecord(service)) {
      throw new Error(`Gateway service binding at index ${index} is invalid.`);
    }
    return service;
  });
  if (parsedServices.some((service) => service["binding"] === "PREVIEW_PROXY")) {
    throw new Error("PREVIEW_PROXY must be a local-only gateway service binding.");
  }
  return [
    ...parsedServices,
    {
      binding: "PREVIEW_PROXY",
      service: "cheatcode-preview-proxy",
    },
  ];
}

function withLocalHyperdrive(
  configPath: WorkerConfig,
  config: ConfigRecord,
  values: Record<string, string>,
): ConfigRecord {
  const bindings = localHyperdriveBindings(configPath, config, values);
  return bindings ? { ...config, hyperdrive: bindings } : config;
}

function localHyperdriveBindings(
  configPath: WorkerConfig,
  config: ConfigRecord,
  values: Record<string, string>,
): ConfigRecord[] | undefined {
  const bindings = config["hyperdrive"];
  const expected = PRODUCTION_DATABASE_URL_BINDINGS[configPath];
  if (!expected) {
    if (bindings !== undefined) {
      throw new Error(`${configPath} unexpectedly declares a HYPERDRIVE binding.`);
    }
    return undefined;
  }
  if (!Array.isArray(bindings)) {
    throw new Error(`${configPath} is missing its HYPERDRIVE binding.`);
  }
  const connectionString = productionDatabaseConnectionString(values, expected);
  let matches = 0;
  const localBindings = bindings.map((binding, index) => {
    if (!isRecord(binding)) {
      throw new Error(`${configPath} has an invalid hyperdrive binding at index ${index}.`);
    }
    if (binding["binding"] !== "HYPERDRIVE") {
      return binding;
    }
    matches += 1;
    return { ...binding, localConnectionString: connectionString };
  });
  if (matches !== 1) {
    throw new Error(`${configPath} must contain exactly one HYPERDRIVE binding.`);
  }
  return localBindings;
}

function productionDatabaseConnectionString(
  values: Record<string, string>,
  expected: { envKey: string; role: string },
): string {
  const raw = values[expected.envKey];
  if (!raw) {
    throw new Error(`.env.local is missing ${expected.envKey}.`);
  }
  validateSupabaseSessionPoolerUrl(raw, expected.envKey, expected.role);
  return raw;
}

function configuredLocalVars(
  configPath: WorkerConfig,
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    LOCAL_WORKER_VAR_BINDINGS[configPath]
      .map((key) => [key, values[key]] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}

function productionVarsRemovedForLocal(configPath: WorkerConfig, vars: ConfigRecord): ConfigRecord {
  if (configPath === "../agent-worker/wrangler.jsonc") {
    const {
      DAYTONA_API_URL: _apiUrl,
      DAYTONA_PREVIEW_HOST_SUFFIXES: _previewHostSuffixes,
      DAYTONA_SANDBOX_SNAPSHOT: _snapshot,
      DAYTONA_TARGET: _target,
      DAYTONA_WORKSPACE_VOLUME: _workspaceVolume,
      OUTPUT_DOWNLOAD_BASE_URL: _outputDownloadBaseUrl,
      PREVIEW_HOSTNAME: _previewHostname,
      ...localVars
    } = vars;
    return localVars;
  }
  if (configPath === "../preview-proxy/wrangler.jsonc") {
    const {
      CHEATCODE_APP_ORIGIN: _appOrigin,
      DAYTONA_API_URL: _apiUrl,
      DAYTONA_PREVIEW_HOST_SUFFIXES: _previewHostSuffixes,
      PREVIEW_HOSTNAME: _previewHostname,
      ...localVars
    } = vars;
    return localVars;
  }
  const { POLAR_PRODUCT_ID_PREMIUM: _premium, POLAR_PRODUCT_ID_PRO: _pro, ...localVars } = vars;
  return localVars;
}

function localClerkAuthorizedParties(webPort: string): string {
  const port = Number(webPort);
  if (!/^\d{1,5}$/u.test(webPort) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }
  return `http://localhost:${port},http://127.0.0.1:${port}`;
}
