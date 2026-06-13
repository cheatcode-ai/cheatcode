---
description: Standardize how the team interacts with Linear from Claude Code. Use when creating issues, updating issue status, querying issues, managing projects, or any Linear operation. Enforces consistent naming, labeling, parent/sub-issue structure, status transitions, and branch naming. Invoked automatically by /plan, /pr, and /pr-review when they interact with Linear. Also use directly when engineer says "create an issue", "update issue", "move issue to done", "what's in progress", or any Linear-related request.
---

# Linear

Standardize all Linear interactions from Claude Code — issue creation, status updates, queries, and conventions.

## Context

Learnings from previous usage (edge cases, patterns, preferences) are auto-merged into this file during sync. To add new learnings, edit the source `LEARNINGS.md` in this skill's folder in the minions repo.

## Core Principles

```
1. CONSISTENCY       - Every engineer's agent creates issues the same way
2. TRACEABILITY      - Issues link to PRs, plan docs, and branches
3. MINIMAL OVERHEAD  - Linear tracks work, it doesn't create work
4. AGENT-FRIENDLY    - Issue descriptions are detailed enough for agents to execute
```

---

## Workspace Structure

### Teams

| Team | Purpose | Issue Prefix |
|------|---------|-------------|
| **Engineering** | All development work | `ENG-` |
| **Operations** | Non-engineering operational work | `OPS-` |

### Issue Statuses (Engineering)

```
Backlog → Todo → In Progress → In Review → Done
                                            ↘ Canceled
                                            ↘ Duplicate
```

| Status | When to Use |
|--------|-------------|
| **Backlog** | Idea captured, not yet prioritized |
| **Todo** | Prioritized, ready to be picked up |
| **In Progress** | Engineer is actively working on it |
| **In Review** | PR opened, awaiting review |
| **Done** | PR merged, feature shipped |
| **Canceled** | Decided not to do |
| **Duplicate** | Already exists as another issue |

### Labels

| Label | When to Use |
|-------|-------------|
| **Feature** | New functionality |
| **Bug** | Something broken |
| **Improvement** | Enhancement to existing feature |
| **Need More Clarity** | Requirements are unclear, needs discussion |

### Priority

| Priority | Meaning |
|----------|---------|
| **Urgent** (1) | Drop everything, fix now |
| **High** (2) | Do this week |
| **Normal** (3) | Do this sprint/cycle |
| **Low** (4) | Nice to have, when time permits |

---

## Issue Conventions

### Issue Title Format

```
{Action verb} {what} {context if needed}
```

**Action verbs:** Add, Create, Build, Implement, Fix, Update, Remove, Refactor, Migrate, Integrate

**Examples:**
- `Add call analysis queue and worker`
- `Fix duplicate webhook processing in call handler`
- `Update customer schema with callAnalysis fields`
- `Integrate transcription API for call recordings`

**Bad titles:**
- `Call analysis` — too vague
- `Bug` — no description
- `WIP: maybe add something` — not actionable
- `ENG-123 follow-up` — meaningless without context

### Issue Description Format

#### For Parent Issues (Features)

```markdown
## Overview
{What this feature does and why, 2-3 sentences}

## Plan
See: `docs/plans/{feature-name}.md`

## Flow
1. {Step 1}
2. {Step 2}
3. {Step 3}

## Decisions
| Decision | Choice | Reasoning |
|----------|--------|-----------|
| {what} | {choice} | {why} |

## Sub-Tasks
- [ ] {Sub-task 1}
- [ ] {Sub-task 2}
- [ ] {Sub-task 3}
```

#### For Sub-Issues (Tasks)

```markdown
## What
{Detailed description of what to implement}

## Files
- CREATE: `path/to/new/file.ts`
- MODIFY: `path/to/existing/file.ts`

## Dependencies
- Depends on: ENG-{number} (must be done first)

## Pattern Reference
Follow pattern in: `path/to/reference/file.ts`

## Acceptance Criteria
- [ ] {Specific verifiable outcome}
- [ ] {Specific verifiable outcome}
```

#### For Bug Issues

```markdown
## Bug
{What's happening vs what should happen}

## Reproduction
1. {Step to reproduce}
2. {Step to reproduce}
3. {Observe: bug}

## Expected Behavior
{What should happen instead}

## Root Cause
{If known, otherwise "To investigate"}

## Impact
{Who/what is affected, severity}
```

---

## Parent/Sub-Issue Structure

### When to Use Sub-Issues

Use sub-issues when a feature has **3 or more distinct tasks** that:
- Can be worked on sequentially
- Each has clear completion criteria
- Track progress within a single feature

**Important:** Sub-issues are for **tracking progress**, not for separate PRs. All sub-tasks ship together in **ONE PR** per feature.

### Structure

```
ENG-100: Add call analysis system (parent — Feature label)
├── ENG-101: Add callAnalysis fields to Call schema
├── ENG-102: Create call-analysis BullMQ queue and worker
├── ENG-103: Add webhook handler for recording-ready events
├── ENG-104: Integrate transcription API service
├── ENG-105: Build LLM analysis service for call insights
├── ENG-106: Wire analysis pipeline end-to-end
└── ENG-107: Add API endpoint to fetch analysis results
```

### Rules

- Parent issue has the **Feature** label and links to the plan doc
- Sub-issues inherit the parent's **project** and **priority**
- Sub-issues are ordered by dependency (earlier = do first)
- Sub-issues have detailed descriptions (agent-executable)
- **All sub-issues are worked on the SAME feature branch**
- **ONE PR covers all sub-issues** — sub-issues are moved to Done when their code is written
- When PR is opened → parent moves to In Review
- When PR is merged → parent moves to Done

---

## Branch Naming

Branches are derived from the **parent** issue identifier:

```
feature/{parent-issue-id}-{short-description}
fix/{issue-id}-{short-description}
```

**Examples:**
- `feature/ENG-100-call-analysis` (feature branch — all sub-tasks here)
- `fix/ENG-150-duplicate-webhook`

**Rules:**
- Use the **parent issue ID** for feature branches (not sub-issue IDs)
- All sub-tasks are worked on the SAME branch
- Keep description to 3-4 words, kebab-case
- Always start with `feature/` or `fix/`

---

## Status Transitions

### When to Transition

| Action | Parent Issue | Sub-Issues |
|--------|-------------|------------|
| Engineer starts working | Todo → In Progress | First sub-issue → In Progress |
| Sub-task code written | — | Sub-issue → Done |
| Feature PR opened | In Progress → In Review | All remaining → Done |
| PR has requested changes | In Review → In Progress | — |
| PR merged | In Review → Done | — |
| Work paused/blocked | In Progress → Todo | — |
| Feature abandoned | Any → Canceled | All → Canceled |

### How to Transition

Use Linear MCP tools:

```
# Move issue to In Progress
Use update_issue with state: "In Progress"

# Move issue to In Review
Use update_issue with state: "In Review"

# Move issue to Done
Use update_issue with state: "Done"
```

### Auto-Transitions by Other Skills

| Skill | Transition |
|-------|-----------|
| `/plan` | Creates parent + sub-issues in **Backlog** or **Todo**, moves parent to **In Progress** when ready |
| `/pr` | Moves parent to **In Review**, all sub-issues to **Done** |
| `/pr-review` (approved + merged) | Moves parent to **Done** |

---

## Common Operations

### Create an Issue

```
1. Determine team (usually Engineering)
2. Determine label (Feature, Bug, Improvement)
3. Determine priority (ask engineer if unclear)
4. Determine project (ask engineer if unclear)
5. Write title following conventions
6. Write description following format
7. Use create_issue MCP tool
8. Report issue ID to engineer
```

### Query Issues

```
# My issues
Use list_issues with assignee: "me"

# Issues in a project
Use list_issues with project: "{project name}"

# Issues in progress
Use list_issues with state: "In Progress", team: "Engineering"

# Search for issues
Use list_issues with query: "{search term}"
```

### Update an Issue

```
# Change status
Use update_issue with state: "{new status}"

# Add comment (e.g., PR link, blocker, update)
Use create_comment with issueId and body
```

### Create Sub-Issues

```
1. Create parent issue first, note the ID
2. Create each sub-issue with parentId set to parent's ID
3. Sub-issues inherit team and project from parent
4. Set priority same as parent
```

---

## Projects

### Active Projects

| Project | Description | Lead |
|---------|-------------|------|
| **Torrent** | Core collection system | Jigyansu |
| **Shaastris** | New project | - |
| **Harbor** | Evals for Riverline | Vidhan |
| **Crew** | Team project | Jayanth |

### When to Use Projects

- Every feature issue should belong to a project
- Bug issues belong to the project they affect
- If unsure which project, ask the engineer

---

## Linear MCP Tool Reference

| Action | MCP Tool |
|--------|----------|
| Create issue | `create_issue` |
| Update issue | `update_issue` |
| List issues | `list_issues` |
| Get issue details | `get_issue` |
| Add comment | `create_comment` |
| List projects | `list_projects` |
| List teams | `list_teams` |
| List statuses | `list_issue_statuses` |
| List labels | `list_issue_labels` |

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Create issues without descriptions | Always include structured description |
| Use vague titles like "Fix bug" | Specific: "Fix duplicate webhook in call handler" |
| Skip linking to plan doc | Always link if plan doc exists |
| Leave parent issue open when all sub-issues done | Close parent when all children are done |
| Create issues in wrong team | Engineering for dev work, Operations for ops |
| Forget to set project | Always assign a project |
| Create duplicate issues | Search first using list_issues or query |

---

## Related Skills
- [[pr]] — PRs link to Linear issues
- [[pr-review]] — review status syncs to Linear
- [[plan]] — planning references Linear issues

## Self-Improvement

After completing this skill, if you discovered:
- A new convention needed for issues
- A better description format
- A missing status transition rule
- A new project or label to document

Then **automatically** invoke the `/improve` skill to:
1. Add the learning to `LEARNINGS.md` in this skill folder
2. Update `SKILL.md` if it's a core instruction change
3. Commit and push
4. Notify user to sync


---

# Accumulated Learnings

> Auto-merged from LEARNINGS.md. Apply these edge cases, patterns, and preferences when executing this skill.



## Edge Cases

- Linear MCP uses team names (e.g., "Engineering") not IDs for most operations.
- When creating sub-issues, the parentId must be the issue's UUID, not the display ID (ENG-123). Use get_issue to resolve the UUID first if needed.

## Workspace Details

### Teams
- Engineering (ID: c1a0e8f5-a0e0-479b-8b87-a018db6e4dcb)
- Operations (ID: fab0bf2f-56af-482f-8a54-9761cc7ae6a0)

### Engineering Labels
- Feature (ID: 4bb389a9-f982-4c3b-8503-4198550914f7)
- Bug (ID: c826ee04-45c3-48c5-bf56-8c211cdc13de)
- Improvement (ID: c637cb9f-14f0-41dc-bcdb-06da967d8f8b)
- Need More Clarity (ID: 6534182b-fba5-4642-9461-237d97b1a3e9)

### Engineering Statuses
- Backlog (ID: 7af28faf-177a-48c5-b762-31312cb241df)
- Todo (ID: 8db5fb2e-5837-4c37-8a10-282275d21c52)
- In Progress (ID: 67cd2410-d806-4734-b82f-48daabf5db4c)
- In Review (ID: abe8fafe-5f1a-4a88-97f0-6574c20061cf)
- Done (ID: ee592855-244f-4ef6-b3b5-31e5f112c515)
- Canceled (ID: 8a228608-467d-47a4-a869-3c92e0a3bbe1)
- Duplicate (ID: f860ebac-5315-4b8b-905a-f45077ac796c)

## User Preferences

_(None yet - will be populated as skill is used)_

## Patterns

- Most work goes to Engineering team
- Active projects: Torrent (Jigyansu), Shaastris, Harbor (Vidhan), Crew (Jayanth)
- Default priority is Normal (3) unless specified
