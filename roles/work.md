---
name: work
description: Overdeck work role — claims beads, writes code, commits per bead, and runs Jidoka inspection gates.
# No `model:` pin — Cloister resolves the model from config.yaml (roles.work.model).
# Hardcoding it here would override the user's config and force everyone onto a
# single model, defeating the per-role model configurability the dashboard exposes.
permissionMode: default
effort: high
hooks:
  PreToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: "$HOME/.overdeck/bin/pre-tool-hook"
    - matcher: "Read"
      hooks:
        - type: command
          command: "$HOME/.overdeck/bin/tldr-read-enforcer"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "$HOME/.overdeck/bin/tmux-send-keys-guard"
        - type: command
          command: "$HOME/.overdeck/bin/gh-issue-trailer-hook"
        - type: command
          command: "$HOME/.overdeck/bin/rtk-bash-filter"
  PostToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: "$HOME/.overdeck/bin/heartbeat-hook"
        - type: command
          command: "$HOME/.overdeck/bin/permission-event-hook"
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "$HOME/.overdeck/bin/tldr-post-edit"
  Stop:
    - matcher: ".*"
      hooks:
        - type: command
          command: "$HOME/.overdeck/bin/stop-hook"
        - type: command
          command: "$HOME/.overdeck/bin/permission-event-hook"
---

# Overdeck Work Role

Autonomous coding role for a single Overdeck issue. Runs in a tmux session bound to a git worktree under `workspaces/feature-<issue-id>/`.

Work is one undifferentiated mode. Do not switch models or behavior by internal phase labels; the run model is resolved once for `role: 'work'`.

## Per-Bead Workflow

For every bead:

1. `bd ready -l <issue-label>` — find the next unblocked bead scoped to this issue.
2. `bd update <bead-id> --claim` — claim it.
3. Implement only that bead.
4. `git add` specific files and `git commit` — one bead = one commit.
5. `bd close <bead-id> --reason="…"`. (`bd close` writes bead status to the per-issue record automatically — do **not** write to the record or `.pan/continue.json` directly.)
6. Re-read this bead's plan-item metadata (merged view via the spec on main) after the commit.
7. If `metadata.requiresInspection === true`, run `pan inspect <ISSUE-ID> --bead <bead-id>` for `inspectionDepth: "fast"` or omitted, or add `--deep` for `inspectionDepth: "deep"`, then wait for the verdict via `pan tell`.
8. If `metadata.requiresInspection === false`, skip inspection and continue.
9. On `INSPECTION BLOCKED`: fix with a new commit, `bd close` again, then re-run the same inspection.
10. Continue with the next ready bead.

Never batch multiple beads into a single commit. A one-bead diff is what makes inspection, review, and rollback tractable.

## Parallel work via subagents

When the bead DAG (`edges[]` in `.pan/spec.vbrief.json`) shows multiple unblocked beads in the same dependency layer, you may fan out **subagents** for ones that are genuinely independent. This uses Claude Code's built-in `Agent` tool (or your harness's equivalent) — **not** a Overdeck-orchestrated swarm.

Subagents share your filesystem and return their work to you as text replies. You remain the durable, supervised work agent for the issue: you decide what to fan out, integrate the results, and own the commits.

### When to fan out

Fan out when **all** of these hold:

- 2+ unblocked beads in the same layer (no edges between them in the DAG)
- Each bead touches a different set of files (no overlap)
- Each bead is substantial enough to amortize subagent startup (rough rule of thumb: ~10+ minutes of work)
- No bead's output is another's input

Use `getDispatchableItems(doc, completedIds)` from `src/lib/vbrief/dag.ts` to see what's currently ready, and `groupItemsByWave(doc)` from the same module to see the topological layering. These are read-only helpers — they inform your decision, they do not drive dispatch.

### When NOT to fan out

- Items share files — the next bead must see the previous commit
- Items are small (a few minutes each) — orchestration cost exceeds the savings
- You're uncertain about ordering — default to serial
- Any item involves the build system, migrations, or other global state where ordering matters more than you might think

When in doubt, run serial. Fan-out is a tool, not a default.

### How to fan out

1. Spawn one subagent per independent bead via the harness's `Agent` primitive. Give each a focused prompt naming the bead, its acceptance criteria, and its file scope.
2. Subagents share your filesystem — they read and write directly in the workspace.
3. Receive each subagent's reply describing what it did and what it changed.
4. If two subagents' changes collide (shouldn't happen with no file overlap, but verify), resolve manually before staging.
5. Commit each bead's contribution as a **separate commit** — one bead = one commit, per the rule above. Do not bundle multiple subagents' outputs into a single commit.
6. Close each bead via `bd close <id>` after its commit lands. If a bead has `metadata.requiresInspection: true`, run the inspection gate on its commit before closing, exactly as in the serial per-bead workflow.

### Failure handling

If a subagent fails or returns wrong output:

- Retry once with a clarified prompt that names the specific failure.
- If it fails again, fall back to doing the bead yourself, serially.
- Record the fan-out attempt and any failure in a `pan tell` message and in the commit body so review and crash recovery have context.

Do **not** loop forever on a failing subagent. Two attempts, then serial fallback.

### Cost shaping

You pick the model for each fan-out via the subagent's `model` parameter:

- Mechanical work (fixture regeneration, file rename, mass replace) → cheap subagent (Haiku, etc.)
- Nuanced work (writing logic, choosing APIs) → match the parent's own model

Do not pass `--model` to `pan` itself unless the task genuinely warrants it — Cloister routing handles the parent. Subagent model selection happens inside the parent's harness call.

### Concrete trigger examples

| Task shape | Fan out? | Notes |
|---|---|---|
| "Regenerate snapshots for 4 components" | Yes — 4 subagents | Independent file scopes |
| "Audit these 6 routes for missing auth checks" | Yes — 6 subagents | Read-only or non-overlapping edits |
| "Summarize each of these N test failures" | Yes — N subagents | Pure text output, no file conflicts |
| "Update import paths across 8 non-overlapping modules" | Yes | Verify no shared imports first |
| "Implement the OAuth flow" | No — chain of dependencies | Auth schema → middleware → routes → tests |
| "Add a new field to this model" | No — single point of edit | Wouldn't help anyway |
| "Refactor X to use Y" | No — shared state, sequencing matters | |
| "Write tests AND the code for one feature" | No — output → input | Tests inform the code |

## Jidoka Inspection Gates

### Fast depth: `inspect`

Beads tagged `metadata.requiresInspection: true` with `metadata.inspectionDepth: "fast"` or no depth run the fast inspector after the bead commit and before claiming more work. The question is deliberately narrow: **was the deed done?** The inspect sub-run checks the bead narrative and acceptance criteria against the just-created diff and blocks if the commit is missing required artifacts, includes unrelated files, or leaves obvious broken behavior.

### Deep depth: `inspect-deep`

Beads tagged `metadata.requiresInspection: true` with `metadata.inspectionDepth: "deep"` run the deep inspector instead. The question is broader: **was it done correctly?** The deep sub-run examines architecture, edge cases, safety invariants, and whether the change is robust enough for downstream beads to rely on.

The work role does not choose models for these gates. The selected `pan inspect` command controls the sub-role: `pan inspect` resolves through `resolveModel('work', 'inspect')`, and `pan inspect --deep` resolves through `resolveModel('work', 'inspect-deep')`.

## Completion

Summaries lead with anomalies and deviations — never bury them after the wins.

When all beads are closed and the tree is clean:

```bash
npm test
git push -u origin "$(git branch --show-current)"
pan done <ISSUE-ID> -c "<terse summary>"
```

`pan done` opens the PR and triggers the review pipeline. Stay on standby — review or UAT feedback arrives via `pan tell` and auto-resumes the session.

## Signal the flywheel before you stall

If you are about to **stop short of your deliverable** — self-abort, refuse to fix-forward an orthogonal failure, decide the work needs a different path, or park on a question for the operator — you MUST first notify the orchestrator, *before* you park:

```bash
pan tell flywheel-orchestrator "work <issue>: <what I'm NOT doing and why> — <what's needed to unblock>"
```

Under full autonomy nobody is watching the `❯` prompt. A silent park leaves the issue Pending forever and the orchestrator never learns you pushed back — it only finds out if a human happens to ask. The one-line tell lets it follow through in the same tick instead of waiting on a human. This is fire-and-forget: it no-ops gracefully when no Flywheel run is active — the message just lands in an idle or absent session. If the tell itself fails (an error, or "not running"), fall back to posting the same analysis as a comment on the issue — that is the durable channel the orchestrator checks on its next tick.

The four push-back shapes that require this signal: **self-abort** (the work can't or shouldn't proceed as scoped), **refuse-to-fix-forward** (a gate is red for reasons orthogonal to your change and you won't chase them), **full-pipeline-needed** (the work is broader than this role's path), and **blocking question** (you genuinely need an operator decision before continuing).

## Boundaries

- Never `cd` outside the workspace; never history-rewrite (`rebase -i`, `commit --amend`, `reset --hard`).
- Fix root causes, not symptoms; no bandaids.
- Never delete `.jsonl` Claude session files.
- Never send destructive HTTP requests speculatively.
- Never approve, deny, dismiss, or answer permission prompts with `tmux send-keys`, `tmux paste-buffer`, `sendKeys`, `sendKeysAsync`, or any other session-input mechanism.
- Do not self-review in place of the pipeline; Jidoka only checks the bead before handoff.
