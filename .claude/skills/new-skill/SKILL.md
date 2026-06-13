---
description: Create new Claude Code skills following established patterns. MANDATORY when asked to create, add, or build a new skill. Uses the new-feature workflow (Research → Plan → Execute → Finalize) to ensure skills are comprehensive, self-improving, and consistent with existing skills. Not for updating existing skills (use /improve).
---

# New Skill

Create a new skill for Claude Code following established patterns.

## Context

Before executing, read `LEARNINGS.md` in this skill folder for edge cases and patterns.

## Core Principles

```
1. SELF-IMPROVEMENT IS MANDATORY - Every skill must include self-improvement section
2. CONCISE BUT COMPLETE - Detailed enough to be useful, concise enough to be readable
3. LEARN FROM EXISTING - Study similar skills before creating new ones
4. FOLLOW THE WORKFLOW - Use Research → Plan → Execute → Finalize phases
```

---

## Workflow Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  RESEARCH   │ ──▶ │    PLAN     │ ──▶ │   EXECUTE   │ ──▶ │  FINALIZE   │
│             │     │             │     │             │     │             │
│ • Explore   │     │ • Structure │     │ • Write     │     │ • Verify    │
│ • Similar   │     │ • Sections  │     │ • SKILL.md  │     │ • Commit    │
│ • Questions │     │ • Approval  │     │ • LEARNINGS │     │ • Notify    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

---

## Phase 1: RESEARCH

**Goal:** Understand what the skill should do and learn from similar skills.

### 1.1 Clarify Requirements

Ask the user:
- What problem does this skill solve?
- When should it trigger (automatic vs manual)?
- What are the expected inputs/outputs?
- Which scope? (shared for all repos, or repo-specific like torrent, waves, etc.)

### 1.2 Study Similar Skills

**MANDATORY: Read 2-3 existing skills before writing a new one.**

```bash
# Find all skills in the minions repo
ls ~/Desktop/Riverline/minions/skills/*/SKILL.md
ls ~/Desktop/Riverline/minions/skills/*/*/SKILL.md
```

Study skills with similar characteristics:
| Skill Type | Study These |
|------------|-------------|
| Step-by-step process | `/commit`, `/queue` |
| Multi-phase workflow | `/new-feature`, `/debug`, `/plan` |
| Proactive triggering | `/improve`, `/naming` |
| Code generation | `/queue`, `/env` |
| External tool integration | `/linear`, `/pr` |

### 1.3 Determine Scope

| Skill Scope | Directory | Example |
|-------------|-----------|---------|
| Universal (all repos) | `skills/shared/` | `/commit`, `/pr-review`, `/plan`, `/linear` |
| Torrent-specific | `skills/torrent/` | `/queue`, `/env`, `/debug` |
| Waves-specific | `skills/waves/` | (future) |
| Spring-agent-specific | `skills/spring-agent/` | (future) |

---

## Phase 2: PLAN

**Goal:** Design the skill structure and get approval.

### 2.1 Required Sections

Every skill MUST have:

```markdown
---
description: [REQUIRED] Single sentence describing when to use. Critical for triggering.
---

# Skill Name

[REQUIRED] One-line description.

## Context

[REQUIRED] Reference to LEARNINGS.md.

## When to Use / Steps / Workflow

[REQUIRED] Core instructions.

## Related Skills

[REQUIRED] Wikilinks to connected skills for propagation.

## Self-Improvement

[REQUIRED] Instructions to invoke /improve after use.
```

### 2.2 Optional Sections

Add based on skill needs:

| Section | When to Include |
|---------|-----------------|
| `## Core Principles` | Complex skills with key rules to remember |
| `## Directory Structure` | Skills that create/modify file structures |
| `## Examples` | When showing input/output is helpful |
| `## Checklist` | Multi-step processes that need verification |
| `## Patterns` | Reusable code patterns or approaches |
| `## Quick Reference` | Complex skills needing a cheat sheet |
| `## Rules` | Strict constraints that must be followed |

### 2.3 Present Plan to User

Show:
- Skill name and location
- Proposed sections
- Key behaviors (auto-trigger vs manual, etc.)
- Similar skills used as reference

**Get approval before writing.**

---

## Phase 3: EXECUTE

**Goal:** Write the skill files.

### 3.1 Write Frontmatter Description

**This is the most critical part.** The description determines when Claude invokes the skill.

```markdown
---
description: [Action verb] + [what it does] + [when to use]. [What it handles]. [What it's NOT for].
---
```

**Formula:**
1. Start with action: "Create", "Review", "Debug", "Plan", "Update"
2. Describe what it does
3. List trigger conditions ("Use when...")
4. List what it handles
5. End with exclusions ("Not for...")

**Good examples:**
```
Create git commits with properly formatted messages using (type): message convention. Use when committing code changes, staging files, or finalizing work. Analyzes diffs to determine commit type. Not for pushing to remote or creating PRs.
```

```
Update and improve skills based on new learnings. TRIGGER PROACTIVELY when user provides new rules, standards, preferences, or corrections. Edits SKILL.md for core instruction changes or LEARNINGS.md for edge cases. Not for creating new skills from scratch.
```

**Bad examples:**
```
A skill for commits  ← Too vague, won't trigger properly
```

### 3.2 Write SKILL.md Content

**Style guidelines:**

| Aspect | Guideline |
|--------|-----------|
| Tone | Direct, imperative ("Run this", not "You should run this") |
| Length | 100-300 lines typical, max 500 lines |
| Detail | Enough to execute without external context |
| Examples | Include 2-3 concrete examples |
| Code blocks | Use for commands, file paths, templates |
| Tables | Use for comparisons, mappings, checklists |

**Structure tips:**
- Use headers liberally (easy to scan)
- Keep paragraphs short (2-3 sentences)
- Use bullet points for lists
- Use numbered lists for sequential steps
- Use ASCII diagrams for workflows

### 3.3 Write Related Skills Section

**MANDATORY for every skill.** Link to skills that share context or are affected by changes to this skill.

```markdown
## Related Skills
- [[skill-name]] — brief reason for the relationship
- [[other-skill]] — how they connect
```

**How to determine related skills:**
- Which skills produce input for this skill? (upstream)
- Which skills consume output from this skill? (downstream)
- Which skills cover overlapping domain? (sibling)
- Which skills would need updating if this skill changes? (propagation)

Review the full skill list at `~/Desktop/Riverline/minions/skills/` and identify at least 1-3 connections.

### 3.4 Write Self-Improvement Section

**MANDATORY for every skill.** Use this exact template:

```markdown
## Self-Improvement

After completing this skill, if you discovered:
- A missing step in the workflow
- A better approach
- An edge case not covered

Then **automatically** invoke the `/improve` skill to:
1. Add the learning to `LEARNINGS.md` in this skill folder
2. Update `SKILL.md` if it's a core instruction change
3. Commit and push
4. Notify user to sync
```

### 3.5 Create LEARNINGS.md

Create the learnings file with this template:

```markdown
# Learnings

Edge cases, patterns, and preferences discovered while using this skill.

## Edge Cases

_(None yet - will be populated as skill is used)_

## User Preferences

_(None yet - will be populated as skill is used)_

## Patterns

_(None yet - will be populated as skill is used)_

## Changelog

### YYYY-MM-DD
- Initial skill creation
```

### 3.6 File Locations

```
~/Desktop/Riverline/minions/skills/{scope}/{skill-name}/
├── SKILL.md        # Core instructions (source)
└── LEARNINGS.md    # Edge cases, preferences, patterns (source)
```

**How sync works:** During session start, `sync-minions.sh` merges LEARNINGS.md content into the synced SKILL.md (in `.claude/skills/`). This means Claude automatically reads accumulated learnings when a skill loads — no extra tool call needed. Always edit the source files in `minions/skills/`, never the synced copies.

**Naming:**
- Folder name: kebab-case (`new-skill`, not `newSkill`)
- Must match the command name (`/new-skill`)

---

## Phase 4: FINALIZE

**Goal:** Commit, push, and notify user.

### 4.1 Verify Skill Structure

Checklist:
- [ ] SKILL.md has frontmatter with description
- [ ] Description starts with action verb
- [ ] Description includes "Use when..." triggers
- [ ] Description includes "Not for..." exclusions
- [ ] Context section references LEARNINGS.md
- [ ] Related Skills section with [[wikilinks]] to connected skills
- [ ] Self-Improvement section is present and complete
- [ ] LEARNINGS.md created with template

### 4.2 Commit and Push

```bash
cd ~/Desktop/Riverline/minions

# Pull latest changes first
git pull origin main

# Stage and commit
git add skills/
git commit -m "(feat): add {skill-name} skill

Creates new skill for {brief description}. Includes self-improvement capability."
git push
```

### 4.3 Notify User

Tell user:
1. Skill created at `skills/{scope}/{skill-name}/`
2. Skills will auto-sync to all repos on next Claude session start
3. To sync immediately, restart the Claude session

---

## Quick Reference

### Skill Anatomy

```
┌─────────────────────────────────────────────────────────┐
│ ---                                                     │
│ description: [ACTION] [WHAT] [WHEN]. [HANDLES]. [NOT].  │ ← CRITICAL
│ ---                                                     │
│                                                         │
│ # Skill Name                                            │
│                                                         │
│ One-line summary.                                       │
│                                                         │
│ ## Context                                              │
│ Read LEARNINGS.md...                                    │ ← REQUIRED
│                                                         │
│ ## When to Use / Steps / Workflow                       │ ← Core content
│ ...                                                     │
│                                                         │
│ ## Related Skills                                       │ ← REQUIRED
│ - [[skill]] — reason for connection                     │
│                                                         │
│ ## Self-Improvement                                     │ ← REQUIRED
│ After completing, invoke /improve...                    │
└─────────────────────────────────────────────────────────┘
```

### Common Mistakes

| Mistake | Fix |
|---------|-----|
| Vague description | Be specific about triggers and exclusions |
| Missing self-improvement | Always include the template |
| No Related Skills | Add [[wikilinks]] to at least 1-3 connected skills |
| No LEARNINGS.md | Always create it, even if empty |
| Too verbose | Cut unnecessary words, use tables |
| No examples | Add 2-3 concrete examples |
| Wrong scope | shared for universal, {repo} for specific |

---

## Related Skills
- [[improve]] — improve updates skills, new-skill creates them
- [[naming]] — new skills must follow naming conventions

## Self-Improvement

After completing this skill, if you discovered:
- A missing step in the workflow
- A better approach
- An edge case not covered

Then **automatically** invoke the `/improve` skill to:
1. Add the learning to `LEARNINGS.md` in this skill folder
2. Update `SKILL.md` if it's a core instruction change
3. Commit and push
4. Notify user to sync
