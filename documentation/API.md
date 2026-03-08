# Cheatcode API Reference

All endpoints are prefixed with `/api`. The backend runs on port `8000` by default.

**Base URL:** `http://localhost:8000/api`

## Authentication

Most endpoints require a Clerk JWT token in the `Authorization` header:

```
Authorization: Bearer <clerk-jwt-token>
```

**SSE streaming endpoints** support the token as a query parameter for EventSource compatibility:

```
GET /api/agent-run/{id}/stream?token=<clerk-jwt-token>
```

---

## Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | No | Basic health check (returns status, timestamp, instance ID) |
| `GET` | `/api/health/deep` | No | Comprehensive health check of all components (returns 503 if critical) |

---

## Projects & Threads

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/projects` | Yes | List all projects for the authenticated user |
| `POST` | `/api/projects` | Yes | Create a new project |
| `GET` | `/api/projects/{project_id}` | Yes | Get project details |
| `GET` | `/api/threads` | Yes | List threads (optionally filter by `?project_id=`) |
| `POST` | `/api/threads` | Yes | Create a new thread |

---

## Agent

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/models/available` | Yes | List available LLM models |
| `POST` | `/api/thread/{thread_id}/agent/start` | Yes | Start an agent run on a thread |
| `GET` | `/api/agent-run/{agent_run_id}/stream` | Yes | Stream agent responses via SSE |
| `POST` | `/api/agent-run/{agent_run_id}/stop` | Yes | Stop an active agent run |
| `GET` | `/api/agent-run/{agent_run_id}` | Yes | Get agent run details |
| `GET` | `/api/agent-run/{agent_run_id}/status` | Yes | Get agent run status |
| `GET` | `/api/thread/{thread_id}/agent-runs` | Yes | List all runs for a thread |
| `POST` | `/api/agent/initiate` | Yes | Create project + thread + start agent in one call |

### SSE Stream Format

The `/agent-run/{id}/stream` endpoint returns Server-Sent Events with JSON payloads:

```
event: message
data: {"type": "content", "content": "...", "sequence": 1, "message_id": "..."}

event: message
data: {"type": "tool_call", "tool": "shell", "arguments": {...}, "sequence": 2}

event: message
data: {"type": "tool_result", "tool": "shell", "result": "...", "sequence": 3}
```

The backend sends heartbeat pings every 15 seconds. The stream ends with a control signal (`END_STREAM` or `ERROR`) on the `agent_run:{id}:control` Redis pub/sub channel.

---

## Sandbox

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/project/{project_id}/sandbox/ensure-active` | Yes | Ensure a sandbox is running for the project |
| `POST` | `/api/sandboxes/{sandbox_id}/files` | Yes | Upload files to the sandbox |
| `GET` | `/api/sandboxes/{sandbox_id}/files` | Yes | List files in the sandbox |
| `GET` | `/api/sandboxes/{sandbox_id}/files/tree` | Yes | Get file tree |
| `GET` | `/api/sandboxes/{sandbox_id}/files/content` | Yes | Get file content (use `?path=`) |
| `GET` | `/api/sandboxes/{sandbox_id}/download-archive` | Yes | Download sandbox as archive |
| `DELETE` | `/api/sandboxes/{sandbox_id}/files` | Yes | Delete files |
| `DELETE` | `/api/sandboxes/{sandbox_id}` | Yes | Delete a sandbox |
| `POST` | `/api/sandboxes/{sandbox_id}/execute` | Yes | Execute a shell command |
| `GET` | `/api/sandboxes/{sandbox_id}/sessions/{session_name}/status` | Yes | Get session status |
| `GET` | `/api/sandboxes/{sandbox_id}/preview-url` | Yes | Get web preview URL |
| `GET` | `/api/sandboxes/{sandbox_id}/expo-url` | Yes | Get Expo (mobile) preview URL |
| `GET` | `/api/sandboxes/{sandbox_id}/dev-server/stream` | Yes | Stream dev server output via SSE |

---

## Deployments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/project/{project_id}/deploy/git` | Yes | Deploy project to Vercel |
| `POST` | `/api/project/{project_id}/deploy/git/update` | Yes | Update an existing deployment |
| `GET` | `/api/project/{project_id}/deployment/status` | Yes | Get deployment status |
| `GET` | `/api/project/{project_id}/deployment/live-status` | Yes | Get live deployment status |

---

## Billing

All billing endpoints are prefixed with `/api/billing`.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/billing/status` | Yes | Get subscription status |
| `GET` | `/api/billing/subscription` | Yes | Get subscription details |
| `GET` | `/api/billing/usage-history` | Yes | Get token usage history |
| `GET` | `/api/billing/plans` | Yes | List available plans |
| `POST` | `/api/billing/create-checkout-session` | Yes | Create a checkout session |
| `POST` | `/api/billing/upgrade-plan` | Yes | Upgrade subscription plan |
| `POST` | `/api/billing/openrouter-key` | Yes | Store BYOK OpenRouter key |
| `GET` | `/api/billing/openrouter-key/status` | Yes | Check BYOK key status |
| `DELETE` | `/api/billing/openrouter-key` | Yes | Remove BYOK key |
| `POST` | `/api/billing/openrouter-key/test` | Yes | Test a BYOK key |
| `GET` | `/api/billing/payment-methods/regions` | Yes | List payment method regions |
| `GET` | `/api/billing/payment-methods/all` | Yes | List all payment methods |
| `GET` | `/api/billing/payment-methods/region/{country_code}` | Yes | Get payment methods for a region |
| `POST` | `/api/billing/payment-methods/validate` | Yes | Validate a payment method |
| `GET` | `/api/billing/payment-methods/presets` | Yes | Get payment method presets |
| `GET` | `/api/billing/payment-methods/detect` | Yes | Auto-detect user's region |

### Admin Endpoints

These require an admin API key via `X-API-Key` header.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/billing/admin/reset-quotas` | Admin | Reset user quotas |
| `GET` | `/api/billing/admin/quota-status` | Admin | Get quota status |
| `GET` | `/api/billing/admin/openrouter-cache/info` | Admin | Get OpenRouter cache info |
| `POST` | `/api/billing/admin/openrouter-cache/warm` | Admin | Warm the OpenRouter cache |
| `POST` | `/api/billing/admin/openrouter-cache/clear` | Admin | Clear the OpenRouter cache |

---

## Composio Integrations

All Composio endpoints are prefixed with `/api/composio`.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/composio/health` | Yes | Composio health check |
| `GET` | `/api/composio/categories` | Yes | List tool categories |
| `GET` | `/api/composio/toolkits` | Yes | List available toolkits |
| `GET` | `/api/composio/toolkits/{slug}/icon` | Yes | Get toolkit icon |
| `GET` | `/api/composio/toolkits/{slug}/details` | Yes | Get toolkit details |
| `GET` | `/api/composio/profiles` | Yes | List OAuth profiles |
| `GET` | `/api/composio/profiles/check-name-availability` | Yes | Check profile name availability |
| `GET` | `/api/composio/profiles/{profile_id}` | Yes | Get profile details |
| `POST` | `/api/composio/profiles` | Yes | Create an OAuth profile |
| `PUT` | `/api/composio/profiles/{profile_id}` | Yes | Update a profile |
| `DELETE` | `/api/composio/profiles/{profile_id}` | Yes | Delete a profile |
| `GET` | `/api/composio/profiles/{profile_id}/mcp-config` | Yes | Get MCP config for a profile |
| `GET` | `/api/composio/tools/list` | Yes | List available tools |
| `POST` | `/api/composio/discover-tools/{profile_id}` | Yes | Discover tools for a profile |
| `PUT` | `/api/composio/profiles/{profile_id}/tools` | Yes | Update profile tools |
| `GET` | `/api/composio/connections/status/{connection_id}` | Yes | Get connection status |
| `GET` | `/api/composio/connections` | Yes | List connections |
| `DELETE` | `/api/composio/connections/{connection_id}` | Yes | Delete a connection |

### Secure MCP Endpoints

Prefixed with `/api/composio-secure`.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/composio-secure/composio-profiles` | Yes | List credential profiles |
| `GET` | `/api/composio-secure/composio-profiles/{profile_id}/mcp-url` | Yes | Get MCP URL for a profile |
| `DELETE` | `/api/composio-secure/credential-profiles/{profile_id}` | Yes | Delete a credential profile |
| `POST` | `/api/composio-secure/credential-profiles/bulk-delete` | Yes | Bulk delete credential profiles |
| `PUT` | `/api/composio-secure/credential-profiles/{profile_id}/set-default` | Yes | Set default profile |
| `PUT` | `/api/composio-secure/credential-profiles/{profile_id}/set-dashboard-default` | Yes | Set dashboard default |
| `PUT` | `/api/composio-secure/credential-profiles/{profile_id}/toggle-active` | Yes | Toggle profile active state |
| `GET` | `/api/composio-secure/dashboard-profiles` | Yes | List dashboard profiles |
| `GET` | `/api/composio-secure/dashboard-mcp-urls` | Yes | Get dashboard MCP URLs |

---

## Webhooks

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/webhooks/polar` | Webhook signature | Polar billing webhook handler |

---

## Email

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/send-welcome-email` | Yes | Send welcome email to a new user |

---

## Feature Flags

Only available when `FEATURE_FLAGS_ENABLED=true`.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/feature-flags` | Yes | List all feature flags |
| `GET` | `/api/feature-flags/{flag_name}` | Yes | Get a specific feature flag |

---

## Inngest

| Endpoint | Description |
|----------|-------------|
| `/api/inngest` | Inngest function serve endpoint (used internally by Inngest) |

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "detail": "Error message describing what went wrong"
}
```

Common HTTP status codes:

| Code | Meaning |
|------|---------|
| `400` | Bad request (invalid parameters) |
| `401` | Unauthorized (missing or invalid JWT) |
| `403` | Forbidden (insufficient permissions) |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Internal server error |
