---
description: Create git commits with properly formatted messages using (type): message convention. Use when committing code changes, staging files, or finalizing work. Analyzes diffs to determine commit type (feat, fix, docs, refactor, test, chore, style), writes concise subject lines (max 80 chars), and adds descriptive body (max 300 chars). Not for pushing to remote or creating PRs.
---

# Commit

Create a git commit with a properly formatted message.

## Context

Learnings from previous usage (edge cases, patterns, preferences) are auto-merged into this file during sync. To add new learnings, edit the source `LEARNINGS.md` in this skill's folder in the minions repo.

## Steps

1. Run `git status` to see staged and unstaged changes
2. Run `git diff --cached` to review staged changes
3. If no changes are staged, ask the user what to stage
4. Analyze the changes and determine the commit type:
   - `feat`: New feature
   - `fix`: Bug fix
   - `docs`: Documentation only
   - `refactor`: Code refactoring
   - `test`: Adding or updating tests
   - `chore`: Maintenance tasks
   - `style`: Code style/formatting changes
5. Write a commit message following this format:
   - First line: `(type): short description` (max 80 chars)
   - Blank line
   - Body: Longer description explaining what and why (max 300 chars)
6. Create the commit
7. **Do NOT include any AI model attribution in the commit message**

## Format

```
(type): short description

Longer explanation of what changed and why (max 300 characters).
```

## Rules

- **Type**: Must be one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`
- **Short description**: Max 80 characters, imperative mood ("add" not "added")
- **Long description**: Max 300 characters, explain what and why
- **No AI attribution**: Do not include Co-Authored-By or any mention of AI

## Examples

```
(feat): add user authentication endpoint

Implements JWT-based authentication with refresh tokens. Includes login, logout, and token refresh routes.
```

```
(fix): resolve null pointer in payment processing

Handles edge case where customer payment method is undefined during checkout flow.
```

## Related Skills
- [[pr]] — commits feed into pull requests
- [[pr-review]] — reviewers check commit quality
- [[naming]] — file naming affects commit scope

## Self-Improvement

After completing this skill, if you discovered:
- A check that should be added
- A better review approach
- An edge case not covered

Then **automatically** invoke the `/improve` skill to:
1. Add the learning to `LEARNINGS.md` in this skill folder
2. Update `SKILL.md` if it's a core instruction change
3. Commit and push
4. Notify user to sync