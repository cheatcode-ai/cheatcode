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
  ],
  options: {
    doNotFollow: { path: "node_modules" },
  },
};
