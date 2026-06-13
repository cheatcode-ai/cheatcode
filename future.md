# Cheatcode — Post-V1 Roadmap

> Everything in this file is **explicitly NOT in V1**. [`plan.md`](./plan.md) is the V1 source of truth.
> Items here are forward-looking only. Moving anything from this file into `plan.md` requires an explicit scope-extension decision.

---

## 1. Features cut from V1

These were decided out during V1 planning. They are NOT shipping in V1 and require explicit re-approval to revisit.

| Feature | Status | Rationale |
|---|---|---|
| **Project KB / RAG over user uploads (K1)** | Cut from V1 | Avoids pgvector ingestion pipeline and LlamaParse runtime integration. Dedicated PDF parsing is also cut from V1 and listed below as its own future skill. |
| **Cheatcode-as-MCP-server** | Cut from V1 | Exposing Cheatcode as an MCP server is only valuable if developer audience traction emerges. |
| **v0 Platform API integration** | Cut from V1 | Vendor coupling + cost. We do UI gen via the agent + sandbox, without v0 or shadcn registry MCP tooling. |
| **Shadcn registry MCP/tooling** | Cut from V1 | Normal shadcn UI components stay, but no MCP package or registry-driven agent tool ships in V1. |
| **Sensitive-tool approval gates** | Cut from V1 | V1 does not implement generic approve/reject tool pauses. Sensitive production actions need explicit first-class commands or a future plan update. |
| **Native iOS / Android apps** | Cut from V1 | V1 stays web-only. Native app-store builds remain out of scope until there is clear demand. |
| **Cheatcode Bridge** (local folder sync menubar app) | Cut from V1 | Significant native (Tauri/Electron) effort; not justified pre-revenue. |
| **In-sandbox always-on hosting** (Zo-style services) | Cut from V1 | Different product category; large infra investment. |
| **B4 — Embedded BI tool** | Cut from V1 | Skill-based dashboard generation (`csv-analyst` + Recharts SSR) covers V1 use cases. Cube/Metabase-class infra is months of work. |
| **All multi-channel inbound** (email-as-trigger, SMS-as-trigger, Slack-as-trigger) | Cut from V1 | `apps/inbound-worker`, Resend Inbound, Telnyx phone provisioning, Slack inbound — all out. V1 is web-only. |
| **Cheatcode-owned notifications** | Cut from V1 | No persisted notification center, `/v1/notifications`, notification table, polling bridge, web push, email, SMS, or Slack notification channel. Active-screen feedback uses inline UI only. |
| **Outbound transactional email** | Cut from V1 | No Resend integration. Clerk handles auth emails (welcome, password reset, magic link); Polar handles billing receipts. |
| **Outbound SMS** | Cut from V1 | No Telnyx integration. No phone numbers provisioned. |
| **Inbound webhooks for user-facing surfaces** (e.g., Capy Mail-style `<user>@bot.trycheatcode.com`) | Cut from V1 | Bot subdomain + Resend Inbound + Email Workers all unused in V1. Polar/Clerk/Composio webhooks (server-to-server, no user-facing channel) stay. |
| **Dedicated PDF parsing skill** (`skills/pdf-analyze`) | Cut from V1 | V1 keeps LlamaParse as a validated BYOK provider slot only. A runtime PDF extraction skill needs a separate scope decision and eval set. |
| **Dedicated LaTeX document skill** (`skills/latex-doc`) | Cut from V1 | V1 document generation is DOCX/XLSX/PPTX/PDF through `packages/tools-docs`; LaTeX-specific workflows can be added later if users ask. |
| **Music generation** (Suno-style) | Cut from V1 | No music vendor is in the locked dependency/provider set. |
| **Avatar video generation** (HeyGen-style) | Cut from V1 | No avatar-video vendor is in the locked dependency/provider set. |

---

## 2. v1.5 candidates (first 90 days post-V1 launch)

In rough priority order. Each requires its own scope decision before implementation begins.

1. **User-uploadable skills**
   - CLI: `cheatcode skills add <repo>`
   - Web UI: skill marketplace browse + install
   - Validation pipeline (frontmatter schema check, eval-run before publish)
   - Trigger: V1 launch + 30 days of stable curated-skill marketplace

2. **v0 Platform API as UI generation sub-tool**
   - App-builder mode delegates UI component generation to v0 for higher quality
   - Cost: $3/M tokens (v0-Pro)
   - Trigger: Lovable/v0 directly competing for our app-builder users on UI quality

3. **Connect-My-Mac** (HappyCapy-style)
   - Native macOS menubar app bridging cloud agent to local Mac
   - Use case: agent generates iOS app in CF Container → triggers `eas build` on user's local Xcode → signs and uploads to TestFlight
   - Trigger: mobile-app skill in production with users hitting EAS Build wall

4. **AI phone calls (J7)** — Vapi/Retell integration as a tool
   - Outbound: agent makes calls for appointment booking, customer service
   - Inbound: phone number per user, agent answers
   - $0.07–0.18/min (Retell), BYOK

5. **Visual automation builder (I7)**
   - Zapier-style flow editor with agents as steps
   - Drag-and-drop workflow composition
   - 4–6 weeks of dedicated work; major UX surface area

6. **Conditional triggers (I8)** — Event-based agent runs
   - "If revenue drops 10%, run analysis"
   - Requires (5) infrastructure to be in place
   - Webhook + threshold primitives only; cron-style recurring agents stay out of V2

7. **DB connector (B3)** — Secure user DB introspection
   - Postgres, MySQL, MongoDB, Snowflake clients
   - User provides creds (BYOK)
   - RLS hardening; injection prevention; query sandboxing

8. **Liveblocks / multi-user collaboration** on a project
   - Real-time cursors, presence, comments on the agent thread
   - Useful for teams reviewing pitch decks / research together

9. **Multi-channel inbound** (cut from V1; re-evaluate post-launch)
   - **Email-as-trigger** (Capy Mail-style): `<user>@bot.trycheatcode.com` → starts agent on that user's default project → replies via email
   - **SMS-as-trigger**: Telnyx number per Pro user; inbound SMS starts agent run
   - **Slack-as-trigger**: bot user in user's Slack workspace responds to @-mentions and DMs
   - Requires: `apps/inbound-worker`, Resend Inbound config, Telnyx phone allocation flow (regulatory 10DLC for US numbers), Composio Slack OAuth + event subscription
   - Trigger to revisit: user demand signal (>20% of weekly active users requesting via Discord/support) OR a competitor closes the gap on us in app-builder lane while we open it in inbound channels

10. **Outbound transactional email + SMS**
    - Resend for welcome / quota warning / digest / cancellation / win-back emails
    - Telnyx for SMS notifications on Pro+
    - V1: no Cheatcode-owned notification feature. Clerk handles auth-related email; Polar handles billing receipts.
    - Trigger to revisit: churn analysis shows users miss out-of-app notifications, or users repeatedly ask for email/SMS alerts

11. **Sandbox egress filtering proxy**
    - V1 leaves Blaxel sandbox egress open; abuse is contained by sandbox resource caps, behavioral detection, and audit logging (plan §9.6)
    - v1.5: route sandbox outbound HTTP through a filtering Worker that enforces a domain allowlist (github.com, npm, pypi, common APIs) and blocks known C2/mining domains
    - Trigger to revisit: first observed egress-abuse incident, or a security-conscious customer requires it

---

## 3. v2 deferred items

Long-horizon — beyond the next 90 days. Listed here for awareness only.

- **Cheatcode Bridge** — local folder sync menubar app
- **In-sandbox always-on hosting** — Zo-style services where the user's sandbox runs Postgres / n8n / Discord bots persistently
- **Native iOS / Android apps** — if web-only mobile usage proves insufficient
- **Self-hosted Cheatcode** for enterprise customers (own Cloudflare account + own Supabase)
- **Enterprise SSO** — Clerk Enterprise SAML
- **Compliance certifications** — SOC 2 Type II, HIPAA BAA

---

## 4. Activation triggers

Items waiting for a specific signal before reconsidering:

| Item | Signal to revisit |
|---|---|
| Cheatcode-as-MCP-server | Developer audience traction in V1 (>20% of users connect via Claude Code / Cursor) |
| Embedded BI tool | 10+ users requesting it within 30 days of launch |
| User-uploadable skills | V1 launch stable + 30 days of curated marketplace working |
| v0 Platform API | Direct UI-quality complaints from app-builder users |
| Native mobile apps | Repeated mobile users request native-only capabilities |
| Cheatcode Bridge | Mobile-app skill hitting EAS Build / signing wall regularly |

---

## 5. Scope discipline

**Anything proposed for plan.md that exists in this file requires:**
1. Explicit scope-extension decision from the team
2. Updated V1 acceptance criteria (what existing V1 feature gets cut to make room)
3. Updated 8-week build plan in plan.md §17 — additions must remove or reduce existing scope, not append

The 8-week V1 build plan is locked. Drifting from it = no V1 launch.
