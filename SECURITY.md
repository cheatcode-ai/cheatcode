# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Cheatcode, **please do not open a public issue.**

Instead, email us at **[founders@trycheatcode.com](mailto:founders@trycheatcode.com)** with:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fixes (optional but appreciated)

## Response Timeline

| Step | Timeline |
|------|----------|
| Acknowledgment of your report | Within 48 hours |
| Initial assessment and severity classification | Within 7 days |
| Fix development and testing | Depends on severity |
| Coordinated disclosure | After fix is deployed |

We will keep you informed throughout the process and credit you in the fix (unless you prefer to remain anonymous).

## Scope

The following are in scope for security reports:

- The Cheatcode backend API (`backend/`)
- The Cheatcode frontend application (`frontend/`)
- Authentication and authorization flows
- Sandbox escape or isolation bypass
- Data leakage between users or projects
- API key or secret exposure
- Injection vulnerabilities (SQL, XSS, command injection, etc.)

## Out of Scope

- Vulnerabilities in third-party services (Supabase, Clerk, OpenRouter, Daytona, etc.) -- report these directly to the respective vendors
- Issues that require physical access to a user's device
- Social engineering attacks
- Denial of service attacks
- Reports from automated scanners without a demonstrated exploit

## Safe Harbor

We consider security research conducted in good faith to be authorized. We will not pursue legal action against researchers who:

- Make a good faith effort to avoid privacy violations, data destruction, and service disruption
- Only interact with accounts they own or with explicit permission of the account holder
- Report vulnerabilities promptly and do not exploit them beyond what is necessary to demonstrate the issue
- Do not publicly disclose the vulnerability before we have had a reasonable opportunity to fix it

Thank you for helping keep Cheatcode and its users safe.
