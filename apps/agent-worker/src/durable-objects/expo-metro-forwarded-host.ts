/**
 * Shell migration for Expo projects served through Daytona's proxy chain. Daytona appends its
 * host to `X-Forwarded-Host`, producing a comma-separated value that Metro cannot pass to `URL`.
 * The wrapper preserves any project config and normalizes that header before Metro handles it.
 */
export function metroForwardedHostFixScript(): string {
  return [
    'if [ -f metro.config.js ] && grep -q "x-forwarded-host" metro.config.js; then exit 0; fi',
    "if [ -f metro.config.js ]; then mv metro.config.js metro.config.base.js; fi",
    "cat > metro.config.js <<'METROEOF'",
    METRO_FORWARDED_HOST_CONFIG,
    "METROEOF",
  ].join("\n");
}

const METRO_FORWARDED_HOST_CONFIG = `// Cheatcode: normalise the comma-separated X-Forwarded-Host the preview proxy chain injects so
// Metro's Server can parse the request URL. Wraps the project's base config (or Expo's default).
let config;
try {
  config = require("./metro.config.base.js");
} catch (e) {
  config = require("expo/metro-config").getDefaultConfig(__dirname);
}
const baseEnhance = config.server && config.server.enhanceMiddleware;
config.server = Object.assign({}, config.server, {
  enhanceMiddleware: (middleware, server) => {
    const inner = baseEnhance ? baseEnhance(middleware, server) : middleware;
    return (req, res, next) => {
      const xfh = req.headers["x-forwarded-host"];
      if (typeof xfh === "string" && xfh.indexOf(",") !== -1) {
        req.headers["x-forwarded-host"] = xfh.split(",")[0].trim();
      }
      return inner(req, res, next);
    };
  },
});
module.exports = config;
`;
