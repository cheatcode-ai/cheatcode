import { OPENAPI_ROUTE_IDENTITIES, OPENAPI_ROUTE_KEYS } from "./openapi";

interface RuntimeRoute {
  method: string;
  path: string;
}

const PUBLIC_METHODS = new Set(["DELETE", "GET", "PATCH", "POST"]);
export const UNMATCHED_GATEWAY_ROUTE = "unmatched";

interface GatewayRouteIdentity {
  operationId: string;
  routeKey: string;
}

const ROUTE_IDENTITIES = OPENAPI_ROUTE_IDENTITIES.map((route) => ({
  operationId: route.operationId,
  pattern: openApiPathPattern(route.path),
  routeKey: `${route.method} ${route.path}`,
}));
const ROUTE_IDENTITY_BY_KEY = new Map(
  ROUTE_IDENTITIES.map((identity) => [identity.routeKey, identity]),
);

/** Resolves a code-authored method/template pair to a bounded public operation identity. */
export function identifyDeclaredGatewayRoute(routeKey: string): GatewayRouteIdentity {
  const normalized = normalizeRouteKey(routeKey);
  const identity = ROUTE_IDENTITY_BY_KEY.get(normalized);
  return identity
    ? { operationId: identity.operationId, routeKey: identity.routeKey }
    : { operationId: UNMATCHED_GATEWAY_ROUTE, routeKey: UNMATCHED_GATEWAY_ROUTE };
}

/** Resolves Hono's matched route template to its stable OpenAPI operation id. */
export function gatewayOperationIdForRegisteredRoute(method: string, path: string): string {
  return identifyDeclaredGatewayRoute(`${method} ${path}`).operationId;
}

/** Resolves a raw request without ever returning its potentially high-cardinality path. */
export function gatewayOperationIdForRequest(request: Request): string {
  const method = request.method.toUpperCase();
  const pathname = new URL(request.url).pathname;
  return (
    ROUTE_IDENTITIES.find(
      (identity) => identity.routeKey.startsWith(`${method} `) && identity.pattern.test(pathname),
    )?.operationId ?? UNMATCHED_GATEWAY_ROUTE
  );
}

/** Fails worker startup when the served public routes and published OpenAPI drift apart. */
export function assertOpenApiRouteParity(runtimeRoutes: readonly RuntimeRoute[]): void {
  const runtimeKeys = runtimeRoutes
    .filter((route) => PUBLIC_METHODS.has(route.method) && isDocumentedPublicPath(route.path))
    .map((route) => `${route.method} ${toOpenApiPath(route.path)}`);
  const duplicateRuntimeKeys = duplicates(runtimeKeys);
  const runtimeSet = new Set(runtimeKeys);
  const documentedSet = new Set(OPENAPI_ROUTE_KEYS);
  const undocumented = [...runtimeSet].filter((key) => !documentedSet.has(key));
  const unserved = [...documentedSet].filter((key) => !runtimeSet.has(key));
  if (duplicateRuntimeKeys.length || undocumented.length || unserved.length) {
    throw new Error(
      [
        duplicateRuntimeKeys.length
          ? `duplicate runtime routes: ${duplicateRuntimeKeys.join(", ")}`
          : "",
        undocumented.length ? `undocumented routes: ${undocumented.join(", ")}` : "",
        unserved.length ? `documented but unserved routes: ${unserved.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}

function isDocumentedPublicPath(path: string): boolean {
  return (
    path === "/docs" || path === "/health" || path === "/openapi.json" || path.startsWith("/v1/")
  );
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
}

function normalizeRouteKey(routeKey: string): string {
  const separator = routeKey.indexOf(" ");
  if (separator < 1) {
    return UNMATCHED_GATEWAY_ROUTE;
  }
  const method = routeKey.slice(0, separator).toUpperCase();
  const path = routeKey.slice(separator + 1);
  return `${method} ${toOpenApiPath(path)}`;
}

function openApiPathPattern(path: string): RegExp {
  const segments = path.split(/(\{[A-Za-z][A-Za-z0-9_]*\})/g);
  const pattern = segments
    .map((segment) => (segment.startsWith("{") ? "[^/]+" : escapeRegex(segment)))
    .join("");
  return new RegExp(`^${pattern}$`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated];
}
