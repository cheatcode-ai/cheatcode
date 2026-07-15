// Supported production web origins.
const PRODUCTION_ORIGINS = new Set(["https://trycheatcode.com"]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

export function resolveCorsOrigin(
  origin: string | undefined,
  environment: "development" | "production",
): string | null | undefined {
  if (!origin) {
    return origin;
  }
  if (
    PRODUCTION_ORIGINS.has(origin) ||
    (environment === "development" && LOCAL_ORIGIN.test(origin))
  ) {
    return origin;
  }
  return null;
}
