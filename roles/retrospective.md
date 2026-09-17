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
1. Per-issue records. Each project line above already carries its `state root` and whether the layout is migrated; the server resolved both through the canonical state resolver before rendering this prompt, so you do not need to resolve them yourself. Records live at `<state root>/records/<issue>.json` when the layout is migrated, and at `<state root>/.pan/records/<issue>.json` when it is legacy. These records are durable canonical per-issue state, mirrored to the `overdeck-state` branch by the state writer — they are a source of truth, not a cache (the SQLite database is the disposable cache, rebuilt from these records plus GitHub, transcripts, and tmux). Read them read-only; never write one. Be aware of the gap: no `pan` verb and no dashboard endpoint currently returns a full record to a shell consumer. `pan show <issue> --json` returns the runtime lens (`issueId`, `agentId`, `shadow`, `health`, `cv`, `pipeline`) and `pan task show <issue> <item> --json` returns one plan item, so neither reaches `feedback`, `scopeDrift`, `sessionHistory`, or `recoveryTrips`. Reading the record JSON under the already-resolved state root is the only path to those four fields today; note that limitation in your report rather than working around it. Keep records whose `updated` is at or after {{WINDOW_START}}. The fields you need are `pipeline` (reviewStatus, reviewedAtCommit, reviewSpawnedAt, testStatus, uatStatus, uatNotes, verificationStatus, verificationNotes, mergeStatus, prUrl), `feedback` (inline specialist findings, each with its own timestamp), `recoveryTrips`, `scopeDrift`, and `sessionHistory` (count review cycles and manual interventions from it).
2. Review reports — every review run writes a directory `<repo path>/workspaces/*/.pan/review/<runId>/` containing one file per source. Self-review runs write `review.md`. The convoy writes `correctness.md`, `security.md`, `performance.md`, and `requirements.md`. Older runs may also have `synthesis.md`. Read every `*.md` under that directory, not just the synthesis — that is where ignored findings, blocking verdicts, and contradictions between sub-roles actually live. Tie each report to its run directory's `headSha` (in `context.json`) when citing it.
3. Feedback files: `<repo path>/workspaces/*/.overdeck/feedback/*.md`. These are written by review and UAT specialists and by operators via the dashboard. They do NOT automatically supersede a verdict: each file carries (or can be cross-referenced against) a run id, head sha, and timestamp, and only the feedback that matches the run/head/time the verdict was produced under supersedes that verdict. Older or unrelated feedback files must be matched to the relevant run before being cited, otherwise the report recreates the stale-approval problem (a later verdict is silently shadowed by a fixed defect that no longer exists).
4. Deacon log: `{{OVERDECK_HOME}}/logs/deacon.log`. It is large; filter lines whose bracketed timestamp is at or after {{WINDOW_START}} (for example `awk -F'[][]' '$2 >= "{{WINDOW_START}}"'`) and look for recoveries, re-dispatches, nudges, stuck flags, orphan cleanups, and auto-resumes.
5. Agent lifecycle logs: `{{OVERDECK_HOME}}/agents/*/lifecycle.log`, plus any spawn failures.
6. CI: `gh run list --repo <github_repo> --created ">={{WINDOW_START}}"` and the `overdeck/test` status stamps on PRs from `gh pr view <n> --json statusCheckRollup`.
7. Issues filed in the window: `gh issue list --repo <github_repo> --search "created:>={{WINDOW_START}}" --label pipeline`, and the same for `blocks-main` and `bug`. Use these to link faults to issues that already exist.

## Output shape

1. **Headline** — issues touched in the window, how many needed more than two review cycles, how many needed manual intervention.
2. **Pipeline and substrate faults** — one bullet each: what happened, the evidence path (file path or command output), and either a link to the existing issue or "needs filing".
3. **Work-agent quality faults** — grouped by tier/model, listing the recurring failure classes with evidence.
4. **Recommended follow-ups** — each with a one-line rationale.

Describe every issue in plain language, never as a bare ID. Keep the report to what the evidence supports; say "no evidence found" for a source that turned up nothing.
