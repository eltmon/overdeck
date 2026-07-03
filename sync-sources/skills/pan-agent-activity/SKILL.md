---
name: pan-agent-activity
description: "Verify Overdeck agents are ACTUALLY moving (real activity, not just alive sessions) via a two-snapshot movement check; classify active / done / wedged and root-cause the wedged"
triggers:
  - verify agent activity
  - are agents actually working
  - agent activity sweep
  - check agents are moving
  - activity snapshot
allowed-tools:
  - Bash
  - Read
---

# pan-agent-activity — verify agents are ACTUALLY moving

A live tmux session ≠ a working agent. Agents idle at a prompt, wedge mid-task, or die
(dead pane, revoked OAuth) while the session stays "alive." This skill proves **movement**
by hashing each agent's pane twice ~25s apart: a changed hash = real activity; an identical
hash = static (then read the pane to tell *done* from *wedged*).

**Doctrine (roles/flywheel.md Mission #4):** a wedged agent is a symptom. Do NOT `pan tell`
a nudge to unstick one instance — find the **root cause** and land the substrate fix so it
self-heals for every agent.

## Step 1 — snapshot 1 (hash every agent pane)

```bash
SP=$(mktemp -d)
: > "$SP/s1"
for s in $(tmux -L overdeck list-sessions -F '#{session_name}' 2>/dev/null \
    | grep -E '^(agent-pan|strike-pan)-[0-9]+(-review|-test|-slot-[0-9])?$' | sort); do
  echo "$s|$(tmux -L overdeck capture-pane -t "$s" -p 2>/dev/null | md5sum | cut -c1-10)" >> "$SP/s1"
done
echo "captured $(wc -l < "$SP/s1") sessions; SP=$SP"
```

## Step 2 — wait, then snapshot 2 + compare

```bash
# ~25s gap (do NOT use foreground sleep in server code; here it's a shell one-off)
timeout 26 bash -c 'until false; do sleep 1; done' 2>/dev/null
printf "%-26s %-8s %s\n" SESSION MOVED? "last activity line"
while IFS='|' read -r s h1; do
  h2=$(tmux -L overdeck capture-pane -t "$s" -p 2>/dev/null | md5sum | cut -c1-10)
  line=$(tmux -L overdeck capture-pane -t "$s" -p 2>/dev/null \
    | grep -vE '^\s*$|^[─│╭╰]|ctx |auto mode|shift\+tab|^\s*›|tokens\)\s*$|default ·' | tail -1 | sed 's/[│─]//g' | cut -c1-44)
  [ "$h1" != "$h2" ] && m="● YES" || m="· static"
  printf "%-26s %-8s %s\n" "$s" "$m" "$line"
done < "$SP/s1"
```

## Step 3 — classify & root-cause the static ones

For each `· static`, read its pane (`tmux -L overdeck capture-pane -t <s> -p -S -20`) and bucket:

| Signal in the pane | Meaning | Action |
| --- | --- | --- |
| `Working (…s • esc to interrupt)`, `Herding`, `Reviewing` (and MOVED) | actively working | none |
| `pan done … completed`, `Slot N work complete`, review "no blocking findings" | done, legit idle | let it flow to review/merge |
| `Pane is dead (status …)` | process exited | **root-cause** the crash (not a re-dispatch reflex) |
| `OVERDECK_SPECIALIST_RESULT: review-agent failed` | often a FALSE signal — verdict was journaled; check `overdeck.db review_status` before assuming dead | fix the signal (substrate), don't re-dispatch blindly |
| `access token could not be refreshed / refresh token was revoked` | usually a **single stale** agent holding a token invalidated by a later re-auth — NOT fleet-wide. GPT-5.5 runs the **codex** harness; its auth is `~/.codex/auth.json` (NOT ohmypi/omp — `pan ohmypi-auth` is omp's separate consumer). | **First** run `codex login status` + `codex doctor`. If "Logged in" / all ✓ → it's a lone stale agent: kill/restart it. Only if genuinely logged out does the operator run `codex login` (interactive). Do NOT alarm fleet-wide off one slot's error. |
| `Waiting on … approval`, idle placeholder (`Implement {feature}`, `Explain this codebase`) with no timer | stalled | root-cause the gate; do not nudge symptom |

**Verify verdicts at the source, not the pane:** the real review/test state is in
`overdeck.db` (NOT the stale `panopticon.db`):
```bash
python3 -c "import sqlite3,os; d=sqlite3.connect('file:'+os.path.expanduser('~/.overdeck/overdeck.db')+'?mode=ro',uri=True); \
c=[x[1] for x in d.execute('PRAGMA table_info(review_status)')]; \
[print(dict(zip(c,r))) for r in d.execute('SELECT * FROM review_status').fetchall() if r[c.index(\"ready_for_merge\")]==1]"
```

## When to run
- **Every flywheel tick** (Observe phase) — a static non-done agent is a bug to root-cause.
- Whenever "agents look busy but nothing merges."
- Read-only; safe to run anytime.
