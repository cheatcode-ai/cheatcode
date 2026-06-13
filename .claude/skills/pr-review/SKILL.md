---
description: Review another engineer's pull request for code quality, design decisions, and plan compliance. Use when reviewing a PR, when engineer says "review PR", "review this PR", "check PR #123", or provides a PR URL/number. Fetches PR diff via gh CLI, reads the linked plan doc for design context, evaluates both code quality AND architectural decisions. Uses Linear MCP for issue context. Not for reviewing your own staged changes (use /review), not for creating PRs (use /pr).
---

# PR Review

Review a pull request for code quality, design decisions, and plan compliance.

## Context

Learnings from previous usage (edge cases, patterns, preferences) are auto-merged into this file during sync. To add new learnings, edit the source `LEARNINGS.md` in this skill's folder in the minions repo.

## Core Principles

```
1. DESIGN BEFORE CODE     - Check if the approach is right before checking if the code is clean
2. PLAN COMPLIANCE        - Verify the PR implements what was planned
3. DECISIONS ARE REVIEWABLE - Evaluate the choices, not just the syntax
4. ACTIONABLE FEEDBACK    - Every comment must be specific and fixable
5. TRUST THE TOOLS        - Don't review formatting/linting — CI handles that
```

---

## Workflow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   GATHER    │ ──▶ │   DESIGN    │ ──▶ │    CODE     │ ──▶ │   VERDICT   │
│             │     │   REVIEW    │     │   REVIEW    │     │             │
│ • PR diff   │     │ • Plan doc  │     │ • Bugs      │     │ • Approve   │
│ • Plan doc  │     │ • Decisions │     │ • Security  │     │ • Request   │
│ • Linear    │     │ • Approach  │     │ • Patterns  │     │ • Report    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

---

## Step 1: GATHER Context

### 1.1 Get PR Details

```bash
# Get PR info (use PR number or URL provided by engineer)
gh pr view {pr-number} --json title,body,headRefName,baseRefName,files,additions,deletions,author

# Get the full diff
gh pr diff {pr-number}
```

### 1.2 Read the PR Description

From the PR body, extract:
- **Summary** — what does this PR claim to do?
- **Linear issue** — which issue is this for?
- **Plan doc** — is there a plan doc linked?
- **Decisions** — what choices were made?
- **Test plan** — how should this be verified?

**If the PR has no description or a vague one:** Flag this immediately.

```
⚠️ PR has no description. Cannot review design decisions without context.
Ask the author to add a description using /pr skill, or provide context here.
```

### 1.3 Read the Plan Doc

If a plan doc is linked (e.g., `docs/plans/{feature}.md`):

```bash
# Checkout the branch to read the plan doc
git fetch origin {branch-name}
```

Read the plan doc and extract:
- The full feature scope (all sub-tasks should be in this one PR)
- Architecture decisions made during planning
- Edge cases that should be handled
- Expected files to create/modify

### 1.4 Get Linear Issue Context

If a Linear issue is referenced, use Linear MCP tools:
- Fetch the issue details
- Read the parent issue for full feature context
- Check if there are specific requirements in the description

---

## Step 2: DESIGN REVIEW (Do This FIRST)

**Before looking at code quality, evaluate the approach.**

### 2.1 Plan Compliance

| Check | Question |
|-------|----------|
| **Scope** | Does this PR cover the complete feature? All sub-tasks included? |
| **Architecture** | Does it follow the architecture described in the plan doc? |
| **App placement** | Is the code in the right app (Execution vs Operations)? |
| **Decisions** | Do the PR decisions align with plan decisions? Any contradictions? |
| **Files** | Are the files created/modified the ones expected by the plan? |

If no plan doc exists, evaluate the approach on its own merits.

### 2.2 Decision Evaluation

For each decision listed in the PR description:

```
Decision: {what was decided}
Choice: {what they chose}

Evaluation:
- Is this the right choice for the problem?
- Are there better alternatives they didn't consider?
- Does this align with existing patterns in the codebase?
- Will this cause problems at scale or over time?
```

**Flag decisions that seem wrong or unconsidered:**

```
⚠️ Decision: "Poll recording API every 30s"
   Concern: There's already a recording-ready webhook in call.route.ts:142.
   Suggestion: Use the existing webhook instead of polling.
```

### 2.3 Missing Considerations

Check if the PR handles what the plan specified:

- [ ] All edge cases from the plan doc addressed?
- [ ] Error handling matches the plan's error handling section?
- [ ] All files listed in the plan accounted for?
- [ ] Nothing extra that wasn't in the plan?

### 2.4 Approach Assessment

Even without a plan doc, evaluate:

| Aspect | Question |
|--------|----------|
| **Simplicity** | Is this the simplest approach that works? |
| **Reuse** | Does similar code already exist that could be extended? |
| **Patterns** | Does it follow existing codebase patterns? |
| **Coupling** | Does it introduce unnecessary dependencies? |
| **Reversibility** | Can this be easily changed or rolled back? |

### 2.5 Protected Files Check

**MANDATORY: Check if the PR modifies any infrastructure or config files.**

Scan the PR's changed files list for these patterns:

```
Protected file patterns:
- .github/workflows/**     — CI/CD pipelines
- .github/**               — Any GitHub config
- .eslintrc*               — ESLint config
- eslint.config.*          — ESLint flat config
- .prettierrc*             — Prettier config
- prettier.config.*        — Prettier config
- tsconfig*.json           — TypeScript config
- .flake8                  — Python linter config
- pyproject.toml           — Python project config (may contain linter settings)
- Makefile                 — Build scripts
- Dockerfile*              — Container config
- docker-compose*.yml      — Container orchestration
- ecosystem.config.js      — PM2 config
- package.json             — Dependencies and scripts
- yarn.lock                — Dependency lock file
```

**If ANY protected files are changed, flag them prominently:**

```
🚨 PROTECTED FILES MODIFIED — Requires careful review

The following infrastructure/config files were changed in this PR:

| File | What Changed | Risk |
|------|-------------|------|
| `.github/workflows/deploy.yml` | {describe what changed} | CI/CD pipeline — can break deployments |
| `eslint.config.mjs` | {describe what changed} | Lint rules — can silently weaken code quality |
| `package.json` | {describe what changed} | Dependencies — check for security, necessity |

⚠️ These files affect ALL developers and the deployment pipeline.
   Review each change carefully and confirm it is intentional and necessary.
```

**For each protected file, answer:**
1. **Is this change necessary?** Does the feature actually require this config change?
2. **Is it correct?** Will it break CI, deployments, or other developers?
3. **Is it scoped?** Does it change only what's needed, or does it have side effects?
4. **Was it discussed?** Is this change mentioned in the plan doc or PR description?

**If a protected file was changed but NOT mentioned in the PR description:** Flag this as a critical issue. Config changes should never be silent.

---

## Step 3: CODE REVIEW

**Only after design review passes, review the code quality.**

### 3.1 Bugs & Logic Errors

- Null/undefined access without checks
- Missing `await` on async operations
- Unhandled promise rejections
- Off-by-one errors in loops/pagination
- Race conditions in concurrent operations
- Incorrect boolean logic
- Missing return statements

### 3.2 Security (OWASP)

- **Auth/Authz**: Missing authentication or authorization checks on endpoints
- **Injection**: Unsanitized input in DB queries, command execution
- **XSS**: User input reflected without sanitization
- **Secrets**: Hardcoded credentials, API keys in code
- **Validation**: Missing input validation at API boundaries
- **Logging**: Sensitive data (passwords, tokens, PII) in logs

### 3.3 Torrent Conventions

**Routes:**
- [ ] Thin routes — HTTP concerns only, business logic in services
- [ ] ObjectIds validated with `validateObjectId()`
- [ ] Specific routes before parameterized (`/all` before `/:id`)
- [ ] Response format: `{ success, message, data/error }`

**Services:**
- [ ] Pure functions — no `req`/`res` objects
- [ ] All parameters and return values typed
- [ ] `.lean()` on read-only queries
- [ ] Descriptive error messages

**TypeScript:**
- [ ] No `any` type
- [ ] No `var`, `.then()` chains, or `require()`
- [ ] Proper import order (external → @torrent/db → aliases → relative)

### 3.4 Code Reuse

Search the codebase for:
- Similar functions that already exist
- Utilities that could replace inline code
- Services that could be extended instead of duplicated

```
⚠️ Duplicate: formatPhoneNumber() at line 45 already exists in @utils/phone.ts
   Suggestion: Import from @utils/phone instead of re-implementing
```

### 3.5 Error Handling

For Execution app code:
- [ ] Sentry error tracking on critical paths
- [ ] Cronitor monitoring on schedulers
- [ ] Structured logging with tags `[Module]`

For all code:
- [ ] try/catch around external API calls
- [ ] Meaningful error messages (not generic "Something went wrong")
- [ ] Errors thrown in services, caught in routes

### 3.6 Database

- [ ] Indexes exist for fields used in `.find()` filters
- [ ] `.select()` used to limit fields returned
- [ ] `.lean()` on read-only queries
- [ ] `findById()` instead of `findOne({ _id })` where applicable
- [ ] ObjectId validation before queries

---

## Step 4: VERDICT

### 4.1 Output Format

```markdown
## PR Review: {PR title}

**PR:** #{number} | **Author:** {author} | **Branch:** {branch}
**Linear:** {issue ID} | **Plan:** {plan doc path or "none"}

---

### Design Review

**Plan Compliance:** ✅ Matches plan / ⚠️ Deviates / ❌ Contradicts
{Details if not compliant}

**Approach:** ✅ Sound / ⚠️ Concerns / ❌ Wrong approach
{Details if concerns}

**Decision Evaluation:**
| Decision | Verdict | Note |
|----------|---------|------|
| {decision} | ✅/⚠️/❌ | {note} |

---

### Code Review

#### Critical (Must fix)
- `file:line` — {issue description}

#### Warning (Should fix)
- `file:line` — {issue description}

#### Suggestion (Nice to have)
- `file:line` — {suggestion}

#### Positive (Good patterns)
- `file:line` — {what's good}

---

### Verdict: {APPROVE / REQUEST CHANGES / NEEDS DISCUSSION}

{Summary — 1-2 sentences on overall assessment}

### Action Items
- [ ] {Specific thing to fix}
- [ ] {Specific thing to fix}
```

### 4.2 Verdict Criteria

| Verdict | When |
|---------|------|
| **APPROVE** | Design is sound, no critical issues, warnings are minor |
| **REQUEST CHANGES** | Critical issues found, or design approach is wrong |
| **NEEDS DISCUSSION** | Design decision needs team input, not just author's fix |

### 4.3 Update Linear

**Always** add a review comment to the parent issue:

```
Use create_comment on parent issue:
"PR #{number} reviewed — {verdict}. {1-line summary of findings}"
```

**Then update statuses based on verdict:**

| Verdict | Parent Issue | Sub-Issues |
|---------|-------------|------------|
| **APPROVE** | Stay In Review (author merges) | No change (already Done) |
| **REQUEST CHANGES** | In Review → In Progress | No change |
| **NEEDS DISCUSSION** | No change | No change |

**After PR is merged** (author or reviewer merges):

```
Use update_issue to move parent issue to "Done"
Use update_issue to move any remaining sub-issues to "Done"
```

**Fetch all sub-issues** using the parent issue ID to ensure none are missed:

```
Use get_issue on parent to get sub-issue IDs
For each sub-issue not already Done → move to Done
```

---

## Step 5: POST-MERGE DEPLOYMENT MONITORING

**After the PR is merged to main, monitor the GitHub Actions deployment.**

This step happens after merge — the reviewer (or merge author) should invoke this or the agent should do it automatically.

### 5.1 Watch the GitHub Action

```bash
# Get the latest workflow run triggered by the merge commit
gh run list --branch main --limit 1 --json databaseId,status,conclusion,name,headSha

# Watch it until completion (polls every 30 seconds)
gh run watch {run-id}
```

### 5.2 On Success — Report

If the workflow succeeds:

```
✅ Deployment successful

Workflow: {workflow name}
Run: {run URL}
Commit: {sha}
Duration: {duration}

All apps are healthy and serving traffic.
```

Add a comment to the Linear parent issue:

```
Use create_comment: "✅ Deployed to production. Workflow run: {run URL}"
```

Move the parent issue to **Done** (if not already).

### 5.3 On Failure — Diagnose and Notify

If the workflow fails:

```bash
# Get the failed run details
gh run view {run-id} --json jobs

# Get logs from the failed job
gh run view {run-id} --log-failed
```

**Analyze the failure:**

| Failure Type | Common Cause | Remediation |
|-------------|-------------|-------------|
| Type check failed | Code that passed locally but fails in CI (missing dependency, env diff) | Fix type errors, push to main |
| Lint failed | Unlinted code got merged | Run `yarn lint:fix`, push to main |
| Build failed | Missing dependency, import error | Check `yarn build` output, fix and push |
| Deploy failed (SSH) | EC2 connectivity issue | Check EC2 status, retry workflow |
| Deploy failed (PM2) | App crash on startup | Check PM2 logs, likely env var or runtime error |
| Health check failed | App started but not responding | Check app logs for startup errors |
| Docker build failed | Dockerfile or dependency issue | Check Docker build logs |

**Report the failure:**

```
❌ Deployment FAILED

Workflow: {workflow name}
Run: {run URL}
Failed job: {job name}
Failed step: {step name}

Error:
{relevant error output from logs — keep concise, max 20 lines}

Root cause: {your analysis}

Remediation:
1. {specific step to fix}
2. {specific step to fix}

⚠️ Main branch is currently broken. Fix urgently.
```

Add a comment to the Linear parent issue:

```
Use create_comment: "❌ Deployment failed after merge. {1-line cause}. See workflow: {run URL}"
```

**Do NOT move the parent issue to Done if deployment failed.** Keep it in In Review until the fix is deployed.

### 5.4 If Fix is Needed

If the failure is caused by the merged code:
1. Create a hotfix commit on main (or a hotfix branch if branch protection is on)
2. Push the fix
3. Monitor the new workflow run
4. Report success/failure again

---

## Reviewing Without a Plan Doc

If there's no plan doc:

1. **Read the PR description carefully** — this is your only context
2. **Ask the author for context if needed** — don't guess at intent
3. **Focus more heavily on design review** — without a plan, bad approaches are more likely
4. **Suggest creating a plan doc** for complex features: "This feature is complex enough to benefit from a plan doc. Consider using `/plan` before implementing."

---

## Reviewing Agent-Written Code

Code written by AI agents has specific patterns to watch for:

| Pattern | What to Check |
|---------|--------------|
| **Over-engineering** | Agent added abstractions, utilities, or error handling that isn't needed |
| **Hallucinated imports** | Agent imported a function/module that doesn't exist |
| **Pattern mismatch** | Agent followed a different pattern than what the codebase uses |
| **Missing edge cases** | Agent handled the happy path but missed failure modes |
| **Verbose code** | Agent wrote 50 lines where 10 would do |
| **Incorrect types** | Agent guessed at types instead of checking schemas |

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Review code before design | Always evaluate approach first |
| "LGTM" without reading the diff | Read every changed line |
| Flag linting/formatting issues | Trust CI to handle these |
| Approve because "the agent wrote it" | Agent code needs MORE scrutiny, not less |
| Block on style preferences | Only block on bugs, security, or wrong approach |
| Review without reading plan doc | Always read the plan doc if it exists |

---

## Related Skills
- [[pr]] — reviews target pull requests
- [[commit]] — review checks commit quality
- [[linear]] — review status syncs to Linear
- [[naming]] — review checks naming conventions

## Self-Improvement

After completing this skill, if you discovered:
- A review check that was missing
- A common agent-written code pattern to watch for
- A better way to structure review feedback

Then **automatically** invoke the `/improve` skill to:
1. Add the learning to `LEARNINGS.md` in this skill folder
2. Update `SKILL.md` if it's a core instruction change
3. Commit and push
4. Notify user to sync


---

# Accumulated Learnings

> Auto-merged from LEARNINGS.md. Apply these edge cases, patterns, and preferences when executing this skill.



## Edge Cases

- When reviewing agent-written code, pay extra attention to hallucinated imports and over-engineering.
- If no plan doc exists, the review should be more thorough on design decisions since there's no pre-approved architecture.

## User Preferences

_(None yet - will be populated as skill is used)_

## Patterns

- Use `gh pr diff {number}` to get the full diff without checking out the branch
- Use `gh pr view {number} --json title,body,headRefName,files` for PR metadata
- Linear MCP tools can fetch issue details for context without leaving Claude Code
