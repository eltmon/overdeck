---
name: work-deft
description: Work-agent kickoff for an issue on Deft Directive's pipeline (PAN-4820) — Deft's own build, pre-PR and review-cycle skills, with Overdeck's hosting steps only.
requires:
  - ISSUE_ID
  - ISSUE_ID_LOWER
  - WORKSPACE_PATH
  - BRANCH_NAME
  - HIDDEN_PATHS
---

# Working on Issue: {{ISSUE_ID}} (Deft Directive)

**Workspace:** {{WORKSPACE_PATH}}
**Branch:** `{{BRANCH_NAME}}`

This issue runs on Deft Directive's pipeline. Overdeck's plan checklist, its item commands, and `pan done` do not apply.

Use the `deft-directive-build` skill. Your scope xBRIEF lives in `xbrief/active/`. If none exists for {{ISSUE_ID}}, create one from the issue with `deft-directive-refinement`, then promote and activate it with Deft's `scope:*` tasks.

Run `deft-directive-pre-pr` before you push. Open the PR with `gh pr create` from `{{BRANCH_NAME}}`. After the PR is open, if the repository has a bot reviewer that `deft-directive-review-cycle` supports (Greptile today), run that skill until it exits. Otherwise stop. Never merge: a person merges through Overdeck.

Run `pan skills deft save {{ISSUE_ID}}` before you open the PR and after every scope change. It commits the archive itself.

Deft's install files are hidden from git. Never `git add -f` them. These tracked files are hidden and your edits to them will not be committed: {{HIDDEN_PATHS}}. If you need to change one, ask the operator with `pan ask`. A dependency change (adding, removing or upgrading a package, which rewrites `package.json` and the lockfile) needs the issue switched back to Overdeck first.

Overdeck does not run review or test agents for this issue.

To bring main into your branch, run `pan sync-main {{ISSUE_ID}}`. Never run `git rebase` or `git merge` yourself: hidden install files make them abort.
