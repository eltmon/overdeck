# PAN-496: gh issue view fails due to projects classic deprecation warning

## Problem

`gh issue view <number>` (without `--json`) returns non-zero exit code because GitHub's "Projects (classic) is being deprecated" GraphQL warning pollutes the output. The `--json` flag suppresses the warning and works reliably.

## Root Cause

GitHub CLI's non-JSON output path triggers a GraphQL query that includes Projects (classic) data. The deprecation warning causes a non-zero exit code even when the issue exists and data is returned.

## Decision

Update all skill files and CLAUDE.md to always use `--json` with `gh issue view`. The TypeScript code is already safe — both call sites use `--json`, and the `GitHubTracker` class uses Octokit REST API.

## Scope

### In scope
1. Update `skills/plan/SKILL.md` — change bare `gh issue view <number>` to `--json` variant
2. Update `skills/github-cli/SKILL.md` — change bare examples and `--comments` to `--json` variants
3. Update `.claude/skills/` mirrors (plan, github-cli)
4. Add a note to root `CLAUDE.md` about always using `--json` with `gh issue view`

### Out of scope
- TypeScript code changes (already safe)
- `spec-readiness` skills (already use `--json`)
- Upgrading `gh` CLI or changing token scopes

## Files to modify
- `skills/plan/SKILL.md` (line ~63)
- `skills/github-cli/SKILL.md` (lines ~47-51)
- `.claude/skills/plan/SKILL.md` (mirror)
- `.claude/skills/github-cli/SKILL.md` (mirror)
- `CLAUDE.md` (add note)
