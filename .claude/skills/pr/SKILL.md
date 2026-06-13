---
description: Create pull requests with decision-exposing descriptions that link to plan docs and Linear issues. Use when opening a PR, pushing a branch for review, or when engineer says "open a PR", "create PR", "push this for review". Builds structured PR descriptions with summary, decisions made, alternatives considered, and links to plan doc and Linear issue. Updates the Linear parent issue with full implementation doc. Uses gh CLI. Not for reviewing PRs (use /pr-review), not for committing (use /commit), not for merging.
---

# Pull Request

Create a pull request for a complete feature with a structured, decision-exposing description.

## Context

Learnings from previous usage (edge cases, patterns, preferences) are auto-merged into this file during sync. To add new learnings, edit the source `LEARNINGS.md` in this skill's folder in the minions repo.

## Core Principles

```
1. ONE PR PER FEATURE  - All sub-tasks ship together in a single PR
2. DECISIONS OVER DIFFS - The PR description explains WHY, the diff shows WHAT
3. LINK TO CONTEXT      - Every PR connects to its plan doc and Linear issue
4. REVIEWER EFFICIENCY  - A reviewer should understand the PR in 2 minutes without reading every line
```

---

## Workflow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   GATHER    │ ──▶ │   WRITE     │ ──▶ │   CREATE    │ ──▶ │   LINK      │
│             │     │             │     │             │     │             │
│ • Full diff │     │ • Title     │     │ • gh pr     │     │ • Linear    │
│ • Plan doc  │     │ • Body      │     │ • Push      │     │ • Impl doc  │
│ • Linear    │     │ • Decisions │     │ • Labels    │     │ • Status    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

---

## Step 1: GATHER Context

### 1.1 Review All Changes

```bash
# Full diff from the feature branch
git status
git diff --stat main...HEAD
git log --oneline main...HEAD
```

Understand the complete scope:
- Total commits on this branch
- All files changed across all sub-tasks
- Overall size of the feature

### 1.2 Find the Plan Doc

```bash
ls docs/plans/
```

If a plan doc exists, read it. Extract:
- Feature overview and flow
- All sub-tasks and their status
- Architecture decisions made during planning
- Edge cases identified

### 1.3 Find the Linear Parent Issue

Look for the parent issue identifier in:
1. Branch name (e.g., `feature/ENG-123-call-analysis`)
2. Plan doc header
3. Ask the engineer if not found

Fetch the parent issue and all sub-issues using Linear MCP tools.

---

## Step 2: WRITE PR Description

### 2.1 Title

```
{type}: {feature name} (max 70 chars)
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`

Examples:
- `feat: add call analysis pipeline with transcription and LLM insights`
- `feat: whatsapp NPA nudge automation system`
- `fix: overhaul duplicate webhook handling across all channels`

### 2.2 Body Structure

The PR covers the entire feature. Structure the body to guide the reviewer through it:

```markdown
## Summary
{2-4 bullet points explaining WHAT this feature does and WHY it's needed}

## Linear
[ENG-123](https://linear.app/riverline/issue/ENG-123) {use actual issue ID and URL from Linear MCP}

## Plan
`docs/plans/{feature}.md`

## What's Included
{Group changes by sub-task so the reviewer can follow the logical structure}

### {Sub-task 1 title} (ENG-124)
- {What was built}
- Files: `path/to/file.ts`, `path/to/other.ts`

### {Sub-task 2 title} (ENG-125)
- {What was built}
- Files: `path/to/file.ts`

### {Sub-task 3 title} (ENG-126)
- {What was built}
- Files: `path/to/file.ts`

## Architecture
{Brief description of how the pieces fit together — data flow, service interactions}

## Diagrams
{Copy the Mermaid diagrams from the plan doc — data flow, sequence, state, or ER diagrams as applicable}

## Decisions Made
| Decision | Choice | Alternatives Considered | Reasoning |
|----------|--------|------------------------|-----------|
| {what} | {choice} | {alternatives} | {reasoning} |

## Edge Cases Handled
| Scenario | Handling |
|----------|----------|
| {edge case} | {how it's handled} |

## How to Review
{Guide the reviewer through the PR in order}
1. Start with {file/area} — this is the core logic
2. Then check {file/area} — this wires everything together
3. {file/area} is mechanical/boilerplate, skim it

## Test Plan
- [ ] {How to verify the happy path}
- [ ] {Edge case to test}
- [ ] {Regression to check}
```

### 2.3 Decision Documentation

**This is the most important section.** Document every non-obvious choice:

| Type | Example |
|------|---------|
| Architecture | "Chose BullMQ over cron because processing time varies" |
| Data model | "Added field to Call schema instead of new collection for simpler queries" |
| Library choice | "Used zod over joi because existing validation uses zod" |
| Error handling | "Retry 3x with backoff instead of failing immediately because API is flaky" |
| Pattern | "Followed emailAutomation.service.ts pattern for consistency" |

### 2.4 Adapt Based on Feature Type

| Feature Type | Emphasis |
|-------------|----------|
| **New pipeline** (webhook → queue → service) | Data flow diagram, failure handling at each stage |
| **New API endpoints** | Request/response shapes, auth, rate limits |
| **Automation system** | Trigger conditions, scheduling, idempotency |
| **Integration** | External API behavior, retry logic, fallbacks |

---

## Step 3: CREATE the PR

### 3.1 Sync with Main & Resolve Conflicts

**Before pushing, ensure the branch is up to date with main.**

```bash
# Fetch latest main
git fetch origin main

# Check if branch is behind main
BEHIND=$(git rev-list --count HEAD..origin/main)
echo "$BEHIND commits behind main"
```

**If behind (BEHIND > 0), rebase onto main:**

```bash
git rebase origin/main
```

**If rebase has conflicts:**

1. List conflicting files:
```bash
git diff --name-only --diff-filter=U
```

2. For each conflicting file:
   - Read the file to understand both sides of the conflict
   - Resolve by keeping the correct version (usually: keep main's structural changes + your feature's new code)
   - **Never blindly accept one side** — understand what changed on main and why

3. After resolving each file:
```bash
git add {resolved-file}
```

4. Continue the rebase:
```bash
git rebase --continue
```

5. If conflicts are too complex to resolve confidently:
```bash
git rebase --abort
```
Then flag to the engineer:
```
⚠️ Merge conflicts with main are too complex to auto-resolve.
Conflicting files:
- {file1} — {what conflicts}
- {file2} — {what conflicts}

Please resolve manually or pair on this.
```

**If no conflicts, proceed.**

### 3.2 Push Branch

```bash
git push -u origin $(git branch --show-current)
# If rebased, may need force push:
git push -u origin $(git branch --show-current) --force-with-lease
```

**Always use `--force-with-lease`** (never `--force`) when force pushing after rebase — it protects against overwriting someone else's pushes.

### 3.3 Get the Linear Issue URL

Before creating the PR, fetch the Linear issue URL to include in the PR body:

```
Use get_issue MCP tool to get the parent issue details
Extract the issue URL (e.g., https://linear.app/riverline/issue/ENG-123)
Use this URL in the PR body's ## Linear section
```

### 3.4 Create PR with gh CLI

```bash
gh pr create \
  --title "{type}: {feature description}" \
  --body "$(cat <<'EOF'
{full body from step 2, with Linear URL}
EOF
)"
```

After creation, capture the PR URL from the `gh pr create` output — you'll need it for the Linear update.

### 3.5 Set PR Metadata

```bash
# Add labels if applicable
gh pr edit --add-label "feature"

# Add reviewers if engineer specifies
gh pr edit --add-reviewer {username}
```

---

## Step 4: LINK Back

### 4.1 Update Linear Parent Issue with Implementation Doc

Use Linear MCP `update_issue` to update the **parent issue** description with a full implementation section. This turns the Linear issue into the complete record — plan + implementation.

**Append to the parent issue description:**

```markdown
---

## Implementation

**PR:** [#{pr_number} — {pr_title}]({github_pr_url})
**Branch:** {branch}

### What was built
{Concise summary of the complete feature — what the code does end-to-end}

### Sub-tasks completed
| Sub-task | Linear | Status |
|----------|--------|--------|
| {title} | ENG-124 | Done |
| {title} | ENG-125 | Done |
| {title} | ENG-126 | Done |

### Files changed
| File | Action | Purpose |
|------|--------|---------|
| `path/to/file.ts` | CREATED | {what it does} |
| `path/to/existing.ts` | MODIFIED | {what changed} |

### Decisions Made
| Decision | Choice | Alternatives Considered | Reasoning |
|----------|--------|------------------------|-----------|
| {what} | {choice} | {alternatives} | {reasoning} |

### Edge Cases Handled
| Scenario | Handling |
|----------|----------|
| {edge case 1} | {how it's handled} |
| {edge case 2} | {how it's handled} |

### How to test
- [ ] {test step 1}
- [ ] {test step 2}
```

### 4.2 Update Linear Issue Statuses

```
Use update_issue to move parent issue to "In Review"
Use update_issue to move all sub-issues to "Done" (they're all in the PR)
```

### 4.3 Report to Engineer

```
PR created: {PR URL}

Title: {title}
Branch: {branch} → main
Files changed: {count}
Commits: {count}
Linear: ENG-123 updated with implementation doc, moved to "In Review"
Sub-issues: ENG-124, ENG-125, ENG-126 moved to "Done"

Reviewer can use /pr-review to review with full plan context.
```

---

## Multi-Commit PRs

Feature PRs will typically have multiple commits. Include a commit summary:

```markdown
## Commits
1. `abc1234` - Add callAnalysis schema fields
2. `def5678` - Create transcription service
3. `ghi9012` - Build LLM analysis service
4. `jkl3456` - Add queue worker and webhook trigger
5. `mno7890` - Wire pipeline end-to-end, add error handling
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Generic "Updated code" title | Specific type + feature description |
| Empty PR description | Full structured description with all sections |
| Skip decisions section | Document every non-obvious choice |
| PR without Linear link | Always link to the parent issue |
| PR without plan reference | Link to plan doc if one exists |
| "LGTM" test plan | Specific, actionable test steps |
| List files without grouping | Group changes by sub-task for reviewability |

---

## Related Skills
- [[commit]] — PRs are built from commits
- [[pr-review]] — PRs get reviewed
- [[linear]] — PRs link to Linear issues

## Self-Improvement

After completing this skill, if you discovered:
- A PR description section that was missing
- A better way to document decisions
- A pattern for specific PR types

Then **automatically** invoke the `/improve` skill to:
1. Add the learning to `LEARNINGS.md` in this skill folder
2. Update `SKILL.md` if it's a core instruction change
3. Commit and push
4. Notify user to sync


---

# Accumulated Learnings

> Auto-merged from LEARNINGS.md. Apply these edge cases, patterns, and preferences when executing this skill.



## Edge Cases

_(None yet - will be populated as skill is used)_

## User Preferences

_(None yet - will be populated as skill is used)_

## Patterns

- Plan docs live at `docs/plans/{feature-name}.md` in the repo
- Linear issue IDs are extracted from branch names: `feature/ENG-123-description`
- PR body uses heredoc with `gh pr create` to preserve formatting
