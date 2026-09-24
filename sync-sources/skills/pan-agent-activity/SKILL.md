---
name: pan-agent-activity
description: "Verify Overdeck agents are ACTUALLY progressing by READING each agent's real output and assessing what it is doing — not just whether a session is alive or a pane changed"
triggers:
  - verify agent activity
  - are agents actually working
  - agent activity sweep
  - check agents are moving
  - go through all the agents
allowed-tools:
  - Bash
  - Read
---

# pan-agent-activity — READ what each agent is doing and assess progress

A live tmux session ≠ a working agent, and **a changed pane ≠ real progress** (an agent can
churn on duplicate notifications, re-ask the same question, or loop). The only reliable check
is to **READ each agent's actual recent output and judge: is it advancing toward its task/goal,
done, or stalled/errored — and if stalled, WHY (root cause)?** A hash-diff is a coarse liveness
hint at best; it is NOT the method.

**Doctrine (roles/flywheel.md Mission #4):** a stalled/errored agent is a symptom. Do NOT
`pan tell` a nudge to unstick one instance — find the **root cause / substrate bug** and land
the fix so it self-heals for every agent.

## Step 1 — READ every agent's real output (the actual method)

```bash
for s in $(tmux -L overdeck list-sessions -F '#{session_name}' 2>/dev/null \
    | grep -E '^(agent-pan|strike-pan)-[0-9]+(-review|-test|-slot-[0-9])?$' | sort); do
  echo "════════ $s ════════"
  tmux -L overdeck capture-pane -t "$s" -p -S -22 2>/dev/null \
    | grep -vE '^\s*$|^[─│╭╰╮╯▐▛▜▙▟▘▝]|ctx [0-9]|auto mode|shift\+tab|^\s*[0-9]+% \(|tokens\)\s*$|default ·|/[0-9.]+M |Claude Code v|API Usage' \
    | tail -10 | sed 's/^/  /'
done
```

Then **actually read** each block and assess it — do not skim for a spinner. Ask: *what is this
agent's last real action, and is it moving its task forward?*

## Step 2 — assess & bucket (by CONTENT, not by hash)

| What the output shows | Assessment | Action |
| --- | --- | --- |
| tool calls / edits / `Working (…)` advancing its task | **progressing** | none |
| `pan done … completed`, `Slot N work complete`, review "passed/blocked" verdict signaled | **done** | let it flow; if verdict blocked, its work agent should be fixing findings |
| `Pane is dead (status …)` / `token_revoked` / `refresh token was revoked` | **dead** | one stale agent, not fleet-wide — confirm codex fleet with `codex login status` + `codex doctor` (gpt-5.5 and the gpt-5.6 family = **codex** harness, auth `~/.codex/auth.json`, NOT ohmypi); then kill/restart the dead one |
| `OVERDECK_SPECIALIST_RESULT: review-agent failed` **but** a verdict was produced | **FALSE failure** — verify against the PR and the pipeline journal (Step 3) before believing it | fix the signal (substrate), don't re-dispatch blindly |
| POST error e.g. `Effect.catchAll is not a function`, `Project not found for PAN-x`, `Dashboard POST failed` | **substrate bug** blocking status/verdict recording (verdict artifact may be journaled for recovery) | file + root-fix the endpoint/resolver |
| looping on `Deacon: container … crashed and was auto-restarted (attempt 1/5)` duplicates | **container crash-loop and/or duplicate-notification spam** distracting the agent | root-cause the crashing workspace container + the notification dedup |
| reads a kickoff for a **different** issue (e.g. "cede PAN-2203 planning") | **cross-wired kickoff** — wrong brief delivered; agent stops or does wrong work | root-cause the kickoff/message misdelivery; the agent's real task is stalled |
| `Waiting on … approval` / broken gate (0-byte smoke result, ratchet rejects unrelated commit) | **stalled on broken tooling/gate** | root-cause the gate; don't hand-wave it |
| idle placeholder (`Implement {feature}`, `Explain this codebase`) with no recent real action | **idle** — done or wedged; read more history (`-S -40`) to tell which | if wedged, root-cause |

## Step 3 — verify verdicts at the source, not the pane

Panes lie (false "failed", stale text). Overdeck stores no review/test/merge status: the
issue's state is derived from the tracker, the PR, its checks, git, and the terminal backend,
and `pan show` prints it. Review verdicts are PR reviews; the per-issue pipeline journal
(`<workspace>/.overdeck/pipeline.jsonl`) logs what Overdeck did (`review.verdict`,
`verification.failed`, `merge.attempted`, …). Where the journal and the PR disagree, the PR wins.

```bash
pan show PAN-1234 --json | python3 -c "import json,sys; d=json.load(sys.stdin); pr=d.get('pr') or {}; \
print(d['issueId'], 'state='+str(d['state']), 'needs='+str(d.get('attention')), \
'review='+str(pr.get('reviewState')), 'checks='+str(pr.get('checks')), 'mergeable='+str(pr.get('mergeable'))); \
[print('  ', e['at'], e['type'], json.dumps(e.get('data') or {})) for e in d.get('journal', [])[-6:]]"
```

## Step 4 — root-cause, don't nudge

For every stalled/errored agent, name the substrate cause and file/land the fix (Mission #4).
The optional two-snapshot hash (capture pane, wait ~25s, re-capture) is only a tie-breaker to
tell "static" from "slowly working" — never a substitute for reading the output.

## When to run
- **Every flywheel tick** (Observe phase) — read the fleet, don't assume alive == working.
- Whenever "agents look busy but nothing merges." Read-only; safe anytime.
