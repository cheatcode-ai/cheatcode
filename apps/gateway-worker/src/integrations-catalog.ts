import { ComposioClient } from "@cheatcode/composio";
import type { Database } from "@cheatcode/db";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError } from "@cheatcode/observability";
import {
  type IntegrationCatalog,
  IntegrationCatalogSchema,
  IntegrationNameSchema,
  type ToolkitActionsResponse,
  type ToolkitCatalogEntry,
  type ToolkitCategory,
  type UserId,
} from "@cheatcode/types";
import { z } from "zod";
import {
  loadIntegrationAccountSnapshot,
  reconcileIntegrationAccountSnapshot,
} from "./integrations";

export interface IntegrationCatalogEnv {
  COMPOSIO_API_KEY?: WorkerSecret;
  ENTITLEMENTS_CACHE: KVNamespace;
}

const CATALOG_CACHE_KEY = "composio:catalog:v6";
const CATALOG_CACHE_TTL_SECONDS = 21_600; // 6h — the Composio catalog rarely changes.
// Composio caps a toolkit page at 500. Fetch the 500 most-used toolkits (covers all the
// popular one-click-connectable apps) rather than paginating the full ~1500 — pulling
// and parsing every page overruns the Worker isolate.
const TOOLKIT_FETCH_LIMIT = 500;
const CATALOG_CACHE_MAX_CHARACTERS = 1024 * 1024;
const COMPOSIO_REQUEST_TIMEOUT_MS = 30_000;
// Composio exposes a long tail of niche categories; surface the most populated ones
// as filter tabs (sorted by app count) and keep the rest reachable via "All" + search.
const MAX_CATEGORY_TABS = 24;
const CATEGORY_ACRONYMS = new Set(["ai", "api", "crm", "hr", "seo", "sms", "url", "erp"]);

type CatalogToolkit = Omit<ToolkitCatalogEntry, "accounts" | "status">;
type CachedCatalog = { categories: ToolkitCategory[]; toolkits: CatalogToolkit[] };

// The bounded Composio client projects richer toolkit objects to camelCase; keep
// only the catalog fields here. Unknown keys are stripped by the object parse.
const ComposioToolkitSchema = z.object({
  composioManagedAuthSchemes: z.array(z.string().max(200)).max(20).optional(),
  meta: z
    .object({
      categories: z
        .array(z.object({ name: z.string().max(200), slug: z.string().max(200) }))
        .max(50)
        .optional(),
      description: z.string().max(4_000).optional(),
    })
    .optional(),
  name: z.string().max(200),
  noAuth: z.boolean().optional(),
  slug: z.string().max(200),
});
const ComposioToolkitsSchema = z.array(ComposioToolkitSchema).max(TOOLKIT_FETCH_LIMIT);

const CachedCatalogSchema = z.object({
  categories: z
    .array(z.object({ name: z.string().max(200), slug: z.string().max(200) }))
    .max(MAX_CATEGORY_TABS),
  toolkits: z
    .array(
      z.object({
        categorySlugs: z.array(z.string().max(200)).max(50),
        connectable: z.boolean(),
        description: z.string().max(4_000),
        displayName: z.string().max(200),
        name: z.string().max(200),
      }),
    )
    .max(TOOLKIT_FETCH_LIMIT),
});

export async function getIntegrationCatalog(
  db: Database,
  env: IntegrationCatalogEnv,
  userId: UserId,
): Promise<IntegrationCatalog> {
  try {
    const [catalog, accountSnapshot] = await Promise.all([
      loadToolkitCatalog(env),
      loadIntegrationAccountSnapshot(env, userId),
    ]);
    const accountsByToolkit = await reconcileIntegrationAccountSnapshot(
      db,
      userId,
      accountSnapshot,
    );
    const toolkits = catalog.toolkits.map((toolkit) => {
      const accounts = accountsByToolkit.get(toolkit.name) ?? [];
      return {
        ...toolkit,
        accounts,
        status: accounts.some((account) => account.status === "active")
          ? "active"
          : (accounts[0]?.status ?? "not_connected"),
      };
    });
    return IntegrationCatalogSchema.parse({ categories: catalog.categories, toolkits });
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw new APIError(503, "upstream_provider_outage", "Unable to build the Composio catalog", {
      cause: error,
      retriable: true,
    });
  }
}

const TOOLKIT_ACTION_LIMIT = 30;

const RawComposioToolSchema = z.object({
  description: z.string().max(4_000).optional(),
  isDeprecated: z.boolean().optional(),
  name: z.string().max(200),
  slug: z.string().max(200),
});
const RawComposioToolsSchema = z.array(RawComposioToolSchema).max(TOOLKIT_ACTION_LIMIT);

// Lists a toolkit's top actions for the detail drawer (name + description). Uses the
// raw, user-independent tool definitions so it works whether or not the user has
// connected the toolkit yet.
export async function listToolkitActions(
  env: IntegrationCatalogEnv,
  slug: string,
): Promise<ToolkitActionsResponse> {
  const apiKey = await requireComposioApiKey(env.COMPOSIO_API_KEY);
  const composio = new ComposioClient(apiKey);
  try {
    const page = await composio.listTools(
      {
        important: true,
        limit: TOOLKIT_ACTION_LIMIT,
        toolkit: slug,
      },
      COMPOSIO_REQUEST_TIMEOUT_MS,
    );
    const tools = RawComposioToolsSchema.parse(page.items)
      .filter((tool) => tool.isDeprecated !== true)
      .slice(0, TOOLKIT_ACTION_LIMIT);
    return {
      actions: tools.map((tool) => ({
        description: tool.description ?? "",
        name: tool.name ?? tool.slug,
        slug: tool.slug,
      })),
    };
  } catch (error) {
    throw new APIError(503, "upstream_provider_outage", "Unable to load toolkit actions", {
      details: { errorName: error instanceof Error ? error.name : typeof error },
      retriable: true,
    });
  }
}

async function loadToolkitCatalog(env: IntegrationCatalogEnv): Promise<CachedCatalog> {
  const cached = await readCachedCatalog(env.ENTITLEMENTS_CACHE);
  if (cached) {
    return cached;
  }
  const fresh = await fetchToolkitCatalog(env);
  await env.ENTITLEMENTS_CACHE.put(CATALOG_CACHE_KEY, JSON.stringify(fresh), {
    expirationTtl: CATALOG_CACHE_TTL_SECONDS,
  });
  return fresh;
}

async function readCachedCatalog(cache: KVNamespace): Promise<CachedCatalog | null> {
  const raw = await cache.get(CATALOG_CACHE_KEY);
  if (!raw) {
    return null;
  }
  if (raw.length > CATALOG_CACHE_MAX_CHARACTERS) {
    return null;
  }
  try {
    const parsed = CachedCatalogSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function fetchToolkitCatalog(env: IntegrationCatalogEnv): Promise<CachedCatalog> {
  const apiKey = await requireComposioApiKey(env.COMPOSIO_API_KEY);
  const composio = new ComposioClient(apiKey);
  try {
    const response = await composio.listToolkits(
      {
        limit: TOOLKIT_FETCH_LIMIT,
        managedBy: "composio",
        sortBy: "usage",
      },
      COMPOSIO_REQUEST_TIMEOUT_MS,
    );
    return buildCatalog(ComposioToolkitsSchema.parse(response));
  } catch (error) {
    throw new APIError(503, "upstream_provider_outage", "Unable to load the Composio catalog", {
      details: { errorName: error instanceof Error ? error.name : typeof error },
      hint: "Check Composio API availability and COMPOSIO_API_KEY.",
      retriable: true,
    });
  }
}

function buildCatalog(toolkits: z.infer<typeof ComposioToolkitsSchema>): CachedCatalog {
  const categoryInfo = new Map<string, { count: number; name: string }>();
  const entries: CatalogToolkit[] = [];
  for (const toolkit of toolkits) {
    if (!IntegrationNameSchema.safeParse(toolkit.slug).success) {
      continue;
    }
    // Show only one-click-connectable toolkits (Composio-managed auth, or no auth) —
    // the same curated set Cheatcode surfaces. Toolkits that need the user's own API key or
    // OAuth app are skipped rather than shown with a dead Connect button.
    const connectable =
      (toolkit.noAuth ?? false) || (toolkit.composioManagedAuthSchemes?.length ?? 0) > 0;
    if (!connectable) {
      continue;
    }
    const categories = toolkit.meta?.categories ?? [];
    for (const category of categories) {
      const existing = categoryInfo.get(category.slug);
      categoryInfo.set(category.slug, {
        count: (existing?.count ?? 0) + 1,
        name: titleCaseCategory(category.name),
      });
    }
    entries.push({
      categorySlugs: categories.map((category) => category.slug),
      connectable: true,
      description: toolkit.meta?.description ?? "",
      displayName: toolkit.name,
      name: toolkit.slug,
    });
  }
  const categories = Array.from(categoryInfo, ([slug, info]) => ({ ...info, slug }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MAX_CATEGORY_TABS)
    .map(({ name, slug }) => ({ name, slug }));
  return { categories, toolkits: entries };
}

function titleCaseCategory(value: string): string {
  return value
    .split(/\s+/)
    .map((word) =>
      CATEGORY_ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

async function requireComposioApiKey(secret: WorkerSecret | undefined): Promise<string> {
  let value: string | undefined;
  try {
    value = await resolveWorkerSecret(secret);
  } catch {
    value = undefined;
  }
  if (!value) {
    throw new APIError(503, "unavailable_maintenance", "COMPOSIO_API_KEY is not configured", {
      hint: "Set COMPOSIO_API_KEY in the gateway Worker environment.",
      retriable: false,
    });
  }
  return value;
}
