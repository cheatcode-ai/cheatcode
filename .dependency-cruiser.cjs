/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: { path: "^(apps|packages)/" },
      to: { circular: true },
    },
    {
      name: "shared-packages-must-not-import-deployables",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "deployables-must-not-import-other-deployables",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "exa-firecrawl-clients-only-in-research-tools",
      severity: "error",
      from: { pathNot: "^packages/agent-core/src/tools/research/" },
      to: {
        path: "^packages/agent-core/src/tools/research/(exa|firecrawl|provider-http)\\.ts$",
      },
    },
    {
      name: "browser-driver-only-in-browser-tools",
      severity: "error",
      from: { pathNot: "^packages/agent-core/src/tools/browser/" },
      to: {
        path: "^packages/agent-core/src/tools/browser/(actions|runtime)\\.ts$",
      },
    },
    {
      name: "database-must-not-import-billing-policy",
      severity: "error",
      from: { path: "^packages/db/" },
      to: { path: "^packages/billing/" },
    },
    {
      name: "vercel-web-must-not-import-worker-runtime-packages",
      severity: "error",
      from: { path: "^apps/web/" },
      to: {
        // Dependency Cruiser evaluates resolved file paths, not package specifiers.
        path: "^packages/(agent-core|auth|billing|byok|db|observability)(/|$)",
      },
    },
    {
      name: "deployables-must-use-db-repositories",
      severity: "error",
      from: { path: "^apps/" },
      to: { path: "^packages/db/(src|dist)/schema(/|$)" },
    },
    {
      name: "gateway-quota-runtime-only-through-do-shell",
      severity: "error",
      from: {
        path: "^apps/gateway-worker/src/",
        pathNot: "^apps/gateway-worker/src/durable-objects/quota-tracker\\.ts$",
      },
      to: {
        path: "^(@cheatcode/billing/quota-runtime|packages/billing/(src|dist)/quota-runtime\\.(js|ts|d\\.ts))$",
      },
    },
  ],
  options: {
    doNotFollow: { path: "(^|/)(dist|node_modules)/" },
  },
};
