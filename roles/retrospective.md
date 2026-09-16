---
name: retrospective
description: Overdeck kickoff template for the No-project pipeline retrospective conversation (read-only review of recent cross-issue pipeline problems).
---

Pipeline retrospective: {{WINDOW_LABEL}}

You are reviewing everything the Overdeck pipeline did between {{WINDOW_START}} and {{WINDOW_END}} (UTC) across all projects, and writing a retrospective of what went wrong. Model the report on the shape below.

## Ground rules (read-only)

This conversation is read-only. Do not run pipeline mutations of any kind:
- no `pan start`, `pan kill`, `pan resume`, `pan done`, `pan tell`, `pan close`, `pan merge`, `pan reset-session`, `pan unstick`, `pan restart`, `pan reload`, or any other `pan` verb that changes state;
- no `gh issue create`, `gh issue edit`, `gh issue close`, `gh pr merge`, or any other GitHub write;
- no `git commit`, `git push`, `git stash`, `git checkout`, or any write to a workspace or to the `overdeck-state` branch;
- no HTTP POST/DELETE/PATCH to the dashboard.
Reading files, `grep`, `gh issue list`, `gh issue view`, `gh pr view`, `gh run list`, and `pan show`/`pan memory search` are fine. If you believe an issue should be filed, put it under "Recommended follow-ups" and let the operator file it.

## Inputs

Overdeck home: `{{OVERDECK_HOME}}`

Registered projects:
{{PROJECT_LINES}}

For each project:
1. Per-issue records: `<state root>/records/*.json` when the layout is migrated, otherwise `<state root>/.pan/records/*.json`. Use `updated` to keep records touched after {{WINDOW_START}}. Read `pipeline` (reviewStatus, reviewedAtCommit, reviewSpawnedAt, testStatus, uatStatus, uatNotes, verificationStatus, verificationNotes, mergeStatus, prUrl), `feedback`, `recoveryTrips`, `scopeDrift`, and `sessionHistory` (count review cycles and manual interventions from it).
2. Review syntheses: `<repo path>/workspaces/*/.pan/review/*/synthesis.md`, and feedback files under `<repo path>/workspaces/*/.overdeck/feedback/`.
3. Deacon log: `{{OVERDECK_HOME}}/logs/deacon.log`. It is large; filter lines whose bracketed timestamp is at or after {{WINDOW_START}} (for example `awk -F'[][]' '$2 >= "{{WINDOW_START}}"'`) and look for recoveries, re-dispatches, nudges, stuck flags, orphan cleanups, and auto-resumes.
4. Agent lifecycle logs: `{{OVERDECK_HOME}}/agents/*/lifecycle.log`, plus any spawn failures.
5. CI: `gh run list --repo <github_repo> --created ">={{WINDOW_START}}"` and the `overdeck/test` status stamps on PRs from `gh pr view <n> --json statusCheckRollup`.
6. Issues filed in the window: `gh issue list --repo <github_repo> --search "created:>={{WINDOW_START}}" --label pipeline`, and the same for `blocks-main` and `bug`. Use these to link faults to issues that already exist.

## Output shape

1. **Headline** — issues touched in the window, how many needed more than two review cycles, how many needed manual intervention.
2. **Pipeline and substrate faults** — one bullet each: what happened, the evidence path (file path or command output), and either a link to the existing issue or "needs filing".
3. **Work-agent quality faults** — grouped by tier/model, listing the recurring failure classes with evidence.
4. **Recommended follow-ups** — each with a one-line rationale.

Describe every issue in plain language, never as a bare ID. Keep the report to what the evidence supports; say "no evidence found" for a source that turned up nothing.
