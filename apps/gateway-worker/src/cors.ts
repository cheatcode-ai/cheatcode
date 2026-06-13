const PRODUCTION_ORIGIN = /^https:\/\/(www\.)?trycheatcode\.com$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

export function resolveCorsOrigin(origin: string | undefined): string | null | undefined {
  if (!origin) {
    return origin;
  }
  if (LOCAL_ORIGIN.test(origin) || PRODUCTION_ORIGIN.test(origin)) {
    return origin;
  }
  return null;
}
