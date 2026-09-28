---
name: pan-consolidate-conversations
description: "Workflow: take over every open conversation in the current project — read what each one owns, carry its unfinished commitments into this conversation, and archive the ones that are not mid-turn. Use when the operator has lost track of which conversation handles what and wants one conversation to own the project's work streams again."
triggers:
  - take over all conversations
  - take over for them all
  - consolidate conversations
  - archive the older conversations
  - which conversation is handling what
  - reorganize my work streams
  - forgot which conversation
allowed-tools:
  - Bash
  - Read
---

# pan-consolidate-conversations

The operator runs several conversations in one project and loses track of which
one owns which work stream. This skill makes **the conversation you are in** the
single owner: you read every other open conversation in the project, take over
its unfinished commitments, and archive it. You end with a ledger that says what
each archived conversation owned and what you now own.

Archiving is reversible (`pan unarchive-conversation <name>`), and the transcript
stays on disk. But archiving **stops the conversation's runtime** (pane and
harness process tree), so a conversation that is mid-turn loses that turn.

## Steps

### 1. Identify yourself and the project

```bash
pan conv current --json      # your id, name, cwd
DASH=${OVERDECK_DASHBOARD_URL:-http://127.0.0.1:3011}
CONVS=$(mktemp); curl -s "$DASH/api/conversations?limit=1000" > "$CONVS"
```

Read your own row in that list for `projectKey` and `cwd`. The dashboard must be
up (`pan up`); the archive step needs it.

### 2. Scope the conversations

A conversation is in scope when either:

- its `projectKey` equals yours, or
- its `projectKey` is `null` and its `cwd` is under your project root. A
  post-`/clear` continuation row often has no `projectKey`, so the key alone
  misses it.

Exclude:

- **yourself**;
- **system conversations** — names that do not start with a `YYYYMMDD-` date
  (for example `sequencer-runner`). Never archive these.

Rows with `status: ended` and no live session are already dead: archive them
without a digest unless the title suggests real work.

### 3. Decide which are still running

Do **not** trust `isWorking` alone; it can stay `true` after the turn ends. A
conversation is running when either check below is true:

1. **Mid-turn:** the transcript's last `user`/`assistant`/`system` record is not
   a `system` record with `subtype: turn_duration`.
   ```bash
   tail -c 60000 "$(pan conv jsonl <id> | tail -1)" | python3 -c '
   import sys,json
   for l in sys.stdin.read().split("\n")[1:][-12:]:
     try: r=json.loads(l); print(r.get("timestamp"), r.get("type"), r.get("subtype"))
     except Exception: pass'
   ```
2. **Background work:** the harness process has live children (a Monitor, a
   watch loop, a long build). Find the harness PID by its session id, then list
   its children:
   ```bash
   ps -eo pid,etime,args | grep -- "--session-id <claudeSessionId>" | grep -v grep
   ps -o pid,etime,args --ppid <pid>
   ```
   A child that has waited for days on a file that never appeared is stale, not
   running. Say so in the ledger.

Leave running conversations open. Tell the operator which ones and why.

### 4. Digest each conversation

For each in-scope conversation, read the operator's messages and the last
assistant replies, then list its **pending commitments**: promised follow-ups,
things waiting on deploys or approvals, agents it was steering, and questions it
asked the operator that were never answered.

```bash
python3 - "$(pan conv jsonl <id> | tail -1)" <<'EOF'
import json, sys
def text(c):
    if isinstance(c, str): return c
    return ' '.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
users, replies = [], []
for line in open(sys.argv[1]):
    try: r = json.loads(line)
    except Exception: continue
    m = r.get('message')
    if not isinstance(m, dict): continue
    t = text(m.get('content')).strip()
    if not t or t.startswith('<'): continue
    (users if r['type'] == 'user' else replies).append((r.get('timestamp', '')[:16], t))
for ts, t in users[:2] + users[-8:]: print('USER', ts, t[:600].replace('\n', ' '))
for ts, t in replies[-3:]: print('REPLY', ts, t[:2000])
EOF
```

`pan conv jsonl` reports `expired` when the transcript is gone; such a row has
nothing to carry. For a long conversation, also scan replies over ~700 chars in
its last two days: those are its status reports.

Then **verify each commitment against live state** before you adopt it. A
conversation's last report can be hours old. Use `pan show <issue>`, `gh pr view`,
`gh run list --branch main`, and `/api/health` (`buildCommit`) rather than
repeating what the transcript said.

### 5. Archive

Archive the conversations that are not running. POST requests need an `Origin`
header that the dashboard trusts; its own URL works.

```bash
curl -s -X POST -H "Origin: $DASH" -H 'Content-Type: application/json' \
  "$DASH/api/conversations/<name>/archive"
```

- Archive one dead conversation first to prove the call works, then the rest.
- Don't `pan tell` a conversation before archiving it: the pane closes and the
  message is lost.
- Two rows can share one tmux session (a conversation and its post-`/clear`
  continuation). Archive is safe here: the runtime is stopped only when no other
  active row uses the session. Archive the stale row first.
- Agents that reported to an archived conversation (`pan tell` replies) now have
  no one listening. Check them with `pan show` instead.

Re-fetch `/api/conversations` afterwards and confirm only you and the excluded
rows remain in scope.

### 6. Act and report

Do the next step of each adopted commitment that is yours to do. Carry every
**operator decision** forward as a question; don't decide it for them.

Report a ledger:

| Conv | What it owned | State now | What you own now |
| --- | --- | --- | --- |

Follow the ledger with anything left open because it was running, and the open
decisions. Mention that `pan unarchive-conversation <name>` restores any row.

## See also

- `conv-lookup` — read one conversation in depth.
- `unarchive-conversation` — undo an archive.
- `pan-handoff` — the opposite move: hand this conversation to a fresh one.
