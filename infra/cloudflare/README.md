# Cloudflare zone controls

Terraform owns the performance-sensitive zone invariants that cannot live in a
Worker's `wrangler.jsonc`: HTTP/3, TLS 1.3, apex proxy state, gateway cache
bypass, and response compression order.

The frontend apex remains on Vercel and is intentionally `proxied = false`.
Supply the current record type and value shown by Vercel; they are variables
because Vercel may change its prescribed target. Never infer or copy an old
target. The gateway remains the only orange-clouded application hostname.

## Cache matrix

| Surface | Shared cache policy | Reason |
|---|---|---|
| Authenticated `/v1/*` APIs | Never | Tenant identity, permissions, billing, and RLS |
| Clerk, billing, webhooks, telemetry writes | Never | Credentials or state mutation |
| Agent create/reconnect streams | Never; no transform | Private live state and latency-sensitive chunking |
| Signed R2 output downloads | Never by default | User-owned content; capability URLs are not public assets |
| Daytona previews and console | Never | Arbitrary user code and private live state |
| Public catalog/release/skill metadata | Dedicated public hostname/entrypoint only | No such stable unauthenticated surface exists yet |
| Immutable public thumbnails/assets | Conditional future rule | Enable only after repeat-read telemetry justifies it |

The gateway Worker also supplies `private, no-store` by default for every
non-OPTIONS `/v1/*` response that does not already declare a policy. The zone
rule is defense in depth. Do not add a positive cache rule to
`gateway.trycheatcode.com`; create a dedicated public Worker entrypoint first.

R2 Tiered Cache and a custom download domain are intentionally absent: current
outputs are private and telemetry has not established material repeat reads.

## Safe adoption

Existing zone resources must be imported before the first plan. In particular,
import the apex DNS record and any existing phase entrypoint rulesets instead
of allowing Terraform to create competing records or overwrite dashboard rules.
Use a remote, encrypted Terraform backend in the deployment environment; local
state is git-ignored.

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check
terraform validate
terraform plan
```

`terraform apply` is an explicit production operation and is not part of normal
code verification. The API token needs only DNS, Zone Settings, Cache Rules,
and Compression Rules edit permissions for this zone.
