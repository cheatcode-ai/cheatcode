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
      name: "tool-domains-must-not-import-peer-tool-domains",
      severity: "error",
      from: { path: "^packages/(tools-[^/]+)/" },
      to: { path: "^packages/tools-[^/]+/", pathNot: "^packages/$1/" },
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
        path: "^packages/(agent-core|auth|billing|byok|db|observability|tools-[^/]+)(/|$)",
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
