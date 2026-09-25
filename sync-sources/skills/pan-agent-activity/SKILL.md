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

A live pane ≠ a working agent, and **a changed pane ≠ real progress** (an agent can
churn on duplicate notifications, re-ask the same question, or loop). The only reliable check
is to **READ each agent's actual recent output and judge: is it advancing toward its task/goal,
done, or stalled/errored — and if stalled, WHY (root cause)?** A hash-diff is a coarse liveness
hint at best; it is NOT the method.

**Doctrine (roles/flywheel.md, Fix at the root):** a stalled/errored agent is a symptom. Do NOT
`pan tell` a nudge to unstick one instance — find the **root cause / substrate bug** and land
the fix so it self-heals for every agent.

## Step 1 — READ every agent's real output (the actual method)

The agent list comes from `GET /api/agents`, which reads the host's terminal
backend (Herdr by default, tmux only under `terminal.backend: tmux`), and each
agent's output from `GET /api/agents/<id>/conversation`, its transcript, which
exists whatever the backend. Never list or capture agents with
`tmux -L overdeck`: on a Herdr host it sees none of them.

```bash
python3 - <<'PY'
import json, re, urllib.request
def get(path):
    try:
        with urllib.request.urlopen('http://localhost:3011' + path, timeout=60) as r:
            return json.load(r)
    except Exception as e:
        return {'error': str(e)}
AGENT = re.compile(r'^(agent-pan|strike-pan)-[0-9]+(-review|-test|-slot-[0-9])?$')
agents = get('/api/agents')
if isinstance(agents, dict): raise SystemExit(f"/api/agents unavailable: {agents['error']}")
for a in sorted((a for a in agents if AGENT.match(a['id'])), key=lambda a: a['id']):
    live = 'live' if a.get('hasLiveTmuxSession') else 'NO LIVE PANE'
    print(f"════════ {a['id']}  {live}  pane={a.get('paneState')}  {a.get('runtime')}/{a.get('model')} ════════")
    conv = get(f"/api/agents/{a['id']}/conversation")
    if 'error' in conv:
        print(f"  (no transcript: {conv['error']})"); continue
    entries = [(m.get('role'), m.get('text'), m.get('sequence') or 0) for m in conv.get('messages', [])]
    entries += [('tool', f"{w.get('label')}: {w.get('detail')}", w.get('sequence') or 0) for w in conv.get('workLog', [])]
    for role, text, _ in sorted(entries, key=lambda e: e[2])[-10:]:
        print(f"  [{role}] " + ' '.join(str(text or '').split())[:220])
PY
```

`/api/agents` keeps a stopped agent for an hour (longer while its PR is in
play), so a `NO LIVE PANE` row is an agent that died or finished recently.

Then **actually read** each block and assess it — do not skim for a spinner. Ask: *what is this
agent's last real action, and is it moving its task forward?*

## Step 2 — assess & bucket (by CONTENT, not by hash)

| What the output shows | Assessment | Action |
| --- | --- | --- |
| tool calls / edits / `Working (…)` advancing its task | **progressing** | none |
| `pan done … completed`, `Slot N work complete`, review "passed/blocked" verdict signaled | **done** | let it flow; if verdict blocked, its work agent should be fixing findings |
| `NO LIVE PANE` / `pane=exited` / `token_revoked` / `refresh token was revoked` | **dead** | one stale agent, not fleet-wide — confirm codex fleet with `codex login status` + `codex doctor` (gpt-5.5 and the gpt-5.6 family = **codex** harness, auth `~/.codex/auth.json`, NOT ohmypi); then kill/restart the dead one |
| `OVERDECK_SPECIALIST_RESULT: review-agent failed` **but** a verdict was produced | **FALSE failure** — verify against the PR and the pipeline journal (Step 3) before believing it | fix the signal (substrate), don't re-dispatch blindly |
| POST error e.g. `Effect.catchAll is not a function`, `Project not found for PAN-x`, `Dashboard POST failed` | **substrate bug** blocking status/verdict recording (verdict artifact may be journaled for recovery) | file + root-fix the endpoint/resolver |
| looping on `Deacon: container … crashed and was auto-restarted (attempt 1/5)` duplicates | **container crash-loop and/or duplicate-notification spam** distracting the agent | root-cause the crashing workspace container + the notification dedup |
| reads a kickoff for a **different** issue (e.g. "cede PAN-2203 planning") | **cross-wired kickoff** — wrong brief delivered; agent stops or does wrong work | root-cause the kickoff/message misdelivery; the agent's real task is stalled |
| `Waiting on … approval` / broken gate (0-byte smoke result, ratchet rejects unrelated commit) | **stalled on broken tooling/gate** | root-cause the gate; don't hand-wave it |
| idle placeholder (`Implement {feature}`, `Explain this codebase`) with no recent real action | **idle** — done or wedged; print more entries (`[-40:]`) to tell which | if wedged, root-cause |

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
The optional two-snapshot check (read the transcript, wait ~25s, read it again and compare the
last `sequence`) is only a tie-breaker to tell "static" from "slowly working" — never a
substitute for reading the output.

## When to run
- **Every flywheel tick** (Observe phase) — read the fleet, don't assume alive == working.
- Whenever "agents look busy but nothing merges." Read-only; safe anytime.
