---
name: pan-commit
description: Create Panopticon repo commits that satisfy commitlint and husky on the first try
triggers:
  - commit these changes
  - create a commit
  - commit in panopticon
  - make a conventional commit
  - avoid commitlint failure
allowed-tools:
  - Bash
  - Read
---

# Panopticon Commit Helper

Use this skill when committing inside the Panopticon repo so the commit passes this repo's husky and commitlint checks on the first attempt.

## Repo Rules

Read `commitlint.config.js` before drafting a message if you have not already verified the current rules.

Current expectations in this repo:

- Use a conventional commit header: `<type>(<scope>): <subject>`
- `scope` is optional in commitlint, but when you use one, prefer one of the repo scopes:
  - `cloister`
  - `dashboard`
  - `workspace`
  - `cli`
  - `review`
  - `beads`
  - `db`
  - `specialists`
  - `terminal`
  - `infra`
  - `deps`
- Keep the header at or under 100 characters
- If you include a body, keep every body line at or under 100 characters
- Do not add a `Co-Authored-By` trailer in this repo

Preferred types:

- `feat` for new behavior
- `fix` for bug fixes
- `refactor` for structural changes without behavior change
- `test` for test-only changes
- `docs` for documentation-only changes
- `chore` for maintenance work

## Required Workflow

### 1. Inspect commit context

Run these first:

```bash
git status --short --branch
git diff --staged
git diff
git log --oneline -5
```

If there are untracked files to include, stage them explicitly by path. Do not use `git add .` or `git add -A` unless the user explicitly asks.

### 2. Choose the narrowest fitting scope

Map changed files to the closest repo scope. Examples:

- `src/dashboard/frontend/**` or `src/dashboard/server/**` → `dashboard`
- `src/lib/tmux.ts` or terminal streaming code → `terminal`
- `src/cloister/**` or agent orchestration → `cloister`
- `src/cli/**`, `bin/**`, or top-level command behavior → `cli`
- `workspaces/**` lifecycle code → `workspace`
- specialist pipeline code → `specialists` or `review`
- dependency-only updates → `deps`
- infra scripts/config → `infra`

If the change spans multiple areas, choose the scope that best matches the primary reason for the change. If no scope fits cleanly, omit the scope instead of inventing one.

### 3. Draft the commit message

Use one of these safe templates:

```text
feat(cli): add pan-commit skill
fix(dashboard): restore terminal reconnect state
refactor(cloister): simplify specialist handoff flow
test(review): cover failed verification retry path
docs: clarify pan sync workflow
chore(deps): update effect packages
```

For multi-line messages, use a short body that explains why. Keep every body line short.

Good:

```text
fix(dashboard): rehydrate snapshot after reconnect

Restore the initial snapshot step so the UI can recover cleanly after the server restarts.
```

Bad:

```text
add a new thing
feat(skill): something vague and too long that keeps going until it exceeds the header limit and fails lint
feat(unknown): use a scope that is not part of the repo's normal scopes
```

### 4. Commit safely

For a single-line message:

```bash
git commit -m "feat(cli): add pan-commit skill"
```

For a multi-line message:

```bash
git commit -m "$(cat <<'EOF'
fix(dashboard): rehydrate snapshot after reconnect

Restore the initial snapshot step so the UI can recover cleanly after the server restarts.
EOF
)"
```

### 5. If commitlint rejects the message

Do not bypass hooks. Fix the message and retry.

Common fixes:

- `subject-empty` or `type-empty` → rewrite as a conventional commit header
- `scope-enum` warning → switch to one of the known repo scopes, or omit the scope
- `body-max-line-length` → wrap the body to shorter lines
- `header-max-length` → shorten the subject

## Notes

- Always create a new commit rather than amending unless the user explicitly asks to amend.
- If the user asks to commit everything, still inspect the diff first and stage explicit paths.
- If a hook fails for a real code problem rather than message format, fix the underlying issue and then create a new commit.
