---
description: "Auto-improve skills when learnings are discovered. TRIGGER PROACTIVELY when: (1) user provides new rules, standards, preferences, or corrections, (2) you discover a workaround or better pattern than what a skill documents, (3) you correct your own mistake on something a skill handles, (4) you encounter unexpected behavior that a skill should account for, (5) a skill has wrong or missing instructions, (6) the post-skill reflection hook flags a learning. Edits SKILL.md for core changes or LEARNINGS.md for edge cases. Follows [[Related Skills]] wikilinks to propagate updates to connected skills. Commits and pushes to minions repo. Not for creating new skills (use /new-skill)."
---

# Improve Skill

Update a skill based on new learnings discovered during usage.

## Context

Before executing, read `LEARNINGS.md` in this skill folder for additional context and patterns.

**Note:** LEARNINGS.md content is auto-merged into the synced SKILL.md during session start. When Claude invokes a skill, it reads both the instructions AND accumulated learnings in one file. Source files in `minions/skills/` stay separate — always edit the source LEARNINGS.md, never the synced copy.

## When to Use

**IMPORTANT: Trigger this skill PROACTIVELY.** Do NOT wait for the user to explicitly say "update the skill."

### Auto-trigger signals (invoke immediately when any occur):

**From user feedback:**
- User provides a new convention, rule, or standard
- User corrects your behavior on something a skill handles
- User says "always do X" or "never do Y" about a skill-covered topic

**From your own discovery:**
- You find a workaround for something that should work differently
- You correct your own approach mid-task (the wrong approach was what a skill taught you)
- You discover a skill has wrong, missing, or outdated instructions
- You find a better pattern than what's documented in a skill
- You hit an edge case not covered by an existing skill

**From the reflection hook:**
- After a skill finishes, the post-skill hook asks: "did you discover anything?"
- If yes, invoke this skill immediately

**Self-triggering examples:**
- User says "commits should use (type): message format" → Immediately update the commit skill
- You used `/debug` and found the common issues table was missing a pattern → Update debug skill
- You used `/naming` and realized scheduler files have a new convention → Update naming skill
- User says "PR reviews should check for X" → Update the pr-review skill
- You discovered that a deleted skill is still referenced by another → Fix the reference

**Do NOT** just acknowledge the feedback and wait. Act on it immediately.

## Skill File Structure

Skills are organized in the minions repo by scope:
```
~/Desktop/Riverline/minions/skills/
├── shared/           # Skills for all repos
│   └── {skill-name}/
│       ├── SKILL.md
│       └── LEARNINGS.md
├── torrent/          # Torrent-specific skills
│   └── {skill-name}/
│       ├── SKILL.md
│       └── LEARNINGS.md
├── seabird/          # Seabird workflow skills
└── infosec/          # Security & compliance skills
```

## Critical Rules

**ALWAYS edit the source files in the minions repo:**
- Source: `~/Desktop/Riverline/minions/skills/{scope}/{skill-name}/`
- NEVER edit `.claude/skills/` in project repos — those are copies synced by the hook
- Changes to project copies will be OVERWRITTEN on next session start

## Steps

1. **Identify the skill to update**
   - Determine which skill the learning applies to
   - Find it in: `~/Desktop/Riverline/minions/skills/{shared|torrent|seabird|infosec}/{skill}/`

2. **Read current skill files**
   - Read both `SKILL.md` and `LEARNINGS.md`
   - Understand current instructions and existing learnings

3. **Decide where to add the improvement**

   | Type of Learning | Where to Add |
   |------------------|--------------|
   | Edge case discovered | LEARNINGS.md → Edge Cases |
   | User preference | LEARNINGS.md → User Preferences |
   | Pattern noticed | LEARNINGS.md → Patterns |
   | Core instruction change | SKILL.md (update relevant section) |
   | New step required | SKILL.md (update Steps section) |
   | Format/rule change | SKILL.md (update Rules section) |

4. **Apply the improvement**
   - Edit the appropriate file
   - For LEARNINGS.md: Add under correct section with date
   - For SKILL.md: Keep changes minimal and focused
   - Update LEARNINGS.md changelog for any change
   - **Verify `## Related Skills` exists** — if missing, add [[wikilinks]] to connected skills

5. **Commit and push**
   ```bash
   cd ~/Desktop/Riverline/minions

   # Pull latest changes first
   git pull origin main

   # Stage and commit
   git add skills/
   git commit -m "(chore): update {skill-name} skill - {brief description}

   {What was added/changed and why - max 300 chars}"
   git push
   ```

6. **Propagate to related skills (reweave) — MANDATORY**
   This step is NOT optional. Skipping it causes skill drift.
   - [ ] Read the `## Related Skills` section of the skill you just updated
   - [ ] For EACH [[linked skill]]:
     - Read its SKILL.md
     - Determine if the change affects it (shared concept, overlapping domain, upstream/downstream)
     - If yes: apply the same learning to that skill
     - If no: skip (but you MUST check, not assume)
   - [ ] List the skills you checked and your decision for each in the commit message

7. **Notify user**
   - Tell user what was updated and in which file(s)
   - List related skills checked and which ones were also updated
   - Skills will auto-sync to all repos on next Claude session start (learnings are merged into SKILL.md during sync)

## Commit Message Format

```
(chore): update {skill-name} skill - {brief description}

{What was added/changed and why it improves the skill - max 300 chars}
```

**Rules:**
- Type: Use `chore` for skill improvements
- Subject: Max 80 characters
- Description: Max 300 characters
- No AI attribution

## Examples

### Example 1: Edge case (goes to LEARNINGS.md)

User: "When reviewing PRs, also check for console.log statements left in code"

Actions:
1. Read `skills/shared/pr-review/SKILL.md` and `LEARNINGS.md`
2. This is an edge case → Add to LEARNINGS.md under "Edge Cases"
3. Add entry:
   ```
   ### 2026-01-23
   - Check for leftover console.log statements in PR reviews
   ```
4. Update changelog in LEARNINGS.md
5. Commit and push
6. Notify user

### Example 2: Core instruction change (goes to SKILL.md)

User: "Commits should follow this format: (type): message with max 80 chars"

Actions:
1. Read `skills/shared/commit/SKILL.md` and `LEARNINGS.md`
2. This is a format/rule change → Update SKILL.md
3. Update the Format and Rules sections in SKILL.md
4. Add changelog entry in LEARNINGS.md
5. Commit and push
6. Notify user

### Example 3: User preference (goes to LEARNINGS.md)

User: "I prefer verbose commit messages with context"

Actions:
1. Read `skills/shared/commit/SKILL.md` and `LEARNINGS.md`
2. This is a user preference → Add to LEARNINGS.md under "User Preferences"
3. Add entry:
   ```
   ### 2026-01-23
   - User prefers verbose commit messages with additional context
   ```
4. Commit and push
5. Notify user

## Related Skills
- [[new-skill]] — improve updates existing skills, new-skill creates them
- [[health]] — health audits find issues that improve fixes

## Self-Improvement

If you discover improvements to THIS skill while using it:
1. Add to `LEARNINGS.md` in this folder
2. Update `SKILL.md` if needed
3. Commit and push
4. Notify user
