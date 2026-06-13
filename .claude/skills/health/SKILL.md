---
description: "Audit skill system health and consistency. TRIGGER when asked to check skill health, validate skills, or when starting work on the minions repo itself. Checks for stale references, missing files, cross-skill consistency, hook validity, and repo-scope correctness. Not for improving individual skills (use /improve) or creating new skills (use /new-skill)."
---

# Health — Skill System Audit

Diagnose issues across the entire skill system: stale references, missing files, broken cross-links, hook config problems, and sync inconsistencies.

## Context

Learnings from previous usage (edge cases, patterns, preferences) are auto-merged into this file during sync. To add new learnings, edit the source `LEARNINGS.md` in this skill's folder in the minions repo.

## When to Run

- Periodically (e.g., after major skill changes)
- When skills aren't behaving as expected
- After deleting or renaming skills
- When onboarding a new repo to the skill system
- When asked: "check health", "validate skills", "audit skills"

## Checks

Run all checks below. Report findings as a table with severity (ERROR, WARN, INFO).

### 1. Skill File Integrity

For every skill in `~/Desktop/Riverline/minions/skills/`:
- [ ] Has `SKILL.md` with valid frontmatter (`---\ndescription: ...\n---`)
- [ ] Has `LEARNINGS.md`
- [ ] `SKILL.md` has a `## Related Skills` section with [[wikilinks]]
- [ ] `SKILL.md` has a Self-Improvement section
- [ ] Description includes trigger conditions AND exclusions ("Not for...")

```bash
# Find skills missing LEARNINGS.md or proper frontmatter
for skill_dir in ~/Desktop/Riverline/minions/skills/*/*/; do
  skill_name=$(basename "$skill_dir")
  scope=$(basename "$(dirname "$skill_dir")")
  [ ! -f "$skill_dir/SKILL.md" ] && echo "ERROR: $scope/$skill_name missing SKILL.md"
  [ ! -f "$skill_dir/LEARNINGS.md" ] && echo "ERROR: $scope/$skill_name missing LEARNINGS.md"
  head -1 "$skill_dir/SKILL.md" 2>/dev/null | grep -q "^---" || echo "WARN: $scope/$skill_name SKILL.md missing frontmatter"
done
```

### 2. Cross-Skill References & Wikilinks

Check that skills referencing other skills point to skills that exist:
- Search all SKILL.md files for `[[wikilinks]]` and verify each linked skill exists
- Search for patterns like `/skillname`, `skills/{scope}/{name}`, or "invoke the X skill"
- Flag any references to deleted/renamed skills
- Flag skills missing `## Related Skills` section entirely

```bash
# Check wikilinks point to real skills
grep -rn '\[\[' ~/Desktop/Riverline/minions/skills/ --include="*.md" | while read line; do
  linked=$(echo "$line" | grep -o '\[\[[^]]*\]\]' | tr -d '[]')
  for skill in $linked; do
    found=false
    for scope_dir in ~/Desktop/Riverline/minions/skills/*/; do
      [ -d "$scope_dir/$skill" ] && found=true && break
    done
    $found || echo "ERROR: Wikilink [[$skill]] points to non-existent skill — in $(echo "$line" | cut -d: -f1)"
  done
done

# Check for missing Related Skills sections
for skill_dir in ~/Desktop/Riverline/minions/skills/*/*/; do
  skill_name=$(basename "$skill_dir")
  scope=$(basename "$(dirname "$skill_dir")")
  grep -q "## Related Skills" "$skill_dir/SKILL.md" 2>/dev/null || echo "WARN: $scope/$skill_name missing Related Skills section"
done
```

### 3. Repo-Scope Validity

For each repo with a `.claude/repo-scope` file:
- [ ] Every scope listed has a corresponding directory in `minions/skills/`
- [ ] `shared` is NOT listed (it's always included automatically)

```bash
# Check all repo-scope files
RIVERLINE_DIR=~/Desktop/Riverline
for repo_dir in "$RIVERLINE_DIR"/*/; do
  scope_file="$repo_dir/.claude/repo-scope"
  [ ! -f "$scope_file" ] && continue
  repo_name=$(basename "$repo_dir")
  while IFS= read -r scope || [ -n "$scope" ]; do
    scope=$(echo "$scope" | tr -d '[:space:]')
    [ -z "$scope" ] && continue
    [ "$scope" = "shared" ] && echo "WARN: $repo_name repo-scope lists 'shared' (unnecessary, always included)"
    [ ! -d ~/Desktop/Riverline/minions/skills/"$scope" ] && echo "ERROR: $repo_name repo-scope references non-existent scope '$scope'"
  done < "$scope_file"
done
```

### 4. Sync Consistency

Compare skills in each repo's `.claude/skills/` against what minions should be syncing:
- [ ] No extra skills that aren't in minions source
- [ ] No missing skills that should have been synced
- [ ] No stale copies (source newer than target)

```bash
# Compare synced vs source for a repo
repo_dir="$PWD"  # or specify
for skill_dir in "$repo_dir/.claude/skills"/*/; do
  skill_name=$(basename "$skill_dir")
  # Check if source exists in any expected scope
  found=false
  for scope_dir in ~/Desktop/Riverline/minions/skills/shared ~/Desktop/Riverline/minions/skills/*/; do
    [ -d "$scope_dir/$skill_name" ] && found=true && break
  done
  $found || echo "WARN: $skill_name in .claude/skills/ but not found in minions source"
done
```

### 5. Hook Configuration

Check `~/.claude/settings.json`:
- [ ] SessionStart hook exists and points to a valid script
- [ ] Hook script is executable
- [ ] Hook timeout is reasonable (10-30s)

```bash
# Verify hook setup
settings=~/.claude/settings.json
[ ! -f "$settings" ] && echo "ERROR: ~/.claude/settings.json missing"
grep -q "SessionStart" "$settings" 2>/dev/null || echo "ERROR: No SessionStart hook configured"
[ -x ~/.claude/hooks/sync-minions.sh ] || echo "ERROR: sync-minions.sh not executable"
```

### 6. Stale Content Detection

Search all skill files for known stale patterns:
- References to `plugins/` or `/plugin` commands
- References to `marketplace`
- Status codes that don't match sync script output (`content_updated`, `structural_change`)
- References to skills that no longer exist

```bash
# Check for stale patterns
grep -rn "plugin" ~/Desktop/Riverline/minions/skills/ --include="*.md" -i | grep -v "claude-plugin" | grep -v "Plugin for"
grep -rn "marketplace" ~/Desktop/Riverline/minions/skills/ --include="*.md" -i
grep -rn "content_updated\|structural_change" ~/Desktop/Riverline/minions/skills/ --include="*.md"
```

## Output Format

```
# Skill System Health Report

## Summary
- X errors, Y warnings, Z info
- Last sync: {timestamp from sync script}

## Findings

| Severity | Check | Issue | Location |
|----------|-------|-------|----------|
| ERROR | Cross-Ref | Skill 'review' referenced but doesn't exist | skills/shared/improve/SKILL.md:121 |
| WARN | Stale | References '/plugin' command | skills/shared/foo/SKILL.md:45 |
| INFO | Sync | 2 skills newer in source than target | torrent/.claude/skills/ |

## Recommended Actions
1. ...
2. ...
```

## After Running

If issues are found:
1. Fix ERRORs immediately (broken references, missing files)
2. Fix WARNs when convenient (stale content, unnecessary config)
3. Log INFOs in LEARNINGS.md if they represent known patterns
4. Invoke `/improve` for any skill that needs updating

## Related Skills
- [[improve]] — health finds issues, improve fixes them

## Self-Improvement

After completing this skill, if you discovered:
- New stale patterns to check for
- False positives that should be excluded
- Additional consistency checks worth adding

Then invoke `/improve` to update this skill.


---

# Accumulated Learnings

> Auto-merged from LEARNINGS.md. Apply these edge cases, patterns, and preferences when executing this skill.



## Known False Positives

- `plugin` in text like "Claude Code Plugin" or "claude-plugin" directory references are not stale
- `/improve` and `/new-skill` references in Self-Improvement sections are intentional cross-refs
- `skills/shared/improve/SKILL.md` references scope examples that may not all exist yet

## Edge Cases

_None documented yet_

## Patterns

- After deleting a skill, always grep for its name across all other skills
- `grep -qw` can cause false matches (e.g., "review" matching "pr-review") — use space-delimited exact matching
- repo-scope files without trailing newlines cause the last scope to be silently dropped by `read`
