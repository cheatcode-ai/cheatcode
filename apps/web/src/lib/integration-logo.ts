export const INTEGRATION_LOGO_ORIGIN = "https://logos.composio.dev";

export function integrationLogoUrl(slug: string): string {
  return `${INTEGRATION_LOGO_ORIGIN}/api/${encodeURIComponent(slug)}`;
}
