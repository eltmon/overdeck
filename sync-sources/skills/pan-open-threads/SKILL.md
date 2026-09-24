---
name: pan-open-threads
description: >
  Build an "open threads ledger": read every active Overdeck conversation, list
  every topic the operator raised that is still unfinished (what they owe, what
  is at risk, questions agents asked and never got answered, work nobody is
  driving), and publish it as a checkable Claude Code artifact page that
  persists ticks. Re-runs update the same page. Use when the operator says
  they have lost track of what they were juggling, asks "what did I leave
  hanging", "what's still open across my conversations", "where did I leave
  that", or wants the ledger refreshed. Not for pipeline status (use
  pipeline-status) or a daily recap (use pan-recap).
triggers:
  - /pan-open-threads
  - open threads
  - what was I juggling
  - what did I leave hanging
  - where did I leave that
  - what's still open across my conversations
  - refresh the ledger
  - open threads ledger
allowed-tools:
  - Bash
  - Read
  - Write
  - Agent
  - Artifact
---

# pan-open-threads — the open threads ledger

The operator runs many conversations at once and loses track of the small
asks, decisions, and questions inside each one. This skill reads every active
conversation, extracts the unfinished threads, and publishes them as one
checkable page. It is thread-level (what the operator said), not issue-level.

## Output

A Claude Code artifact page titled **Open Threads Ledger**, built from
`{baseDir}/assets/ledger-template.html`. One block per conversation, one
checkbox per open item, each item tagged:

| Tag | Meaning |
| --- | --- |
| `owe` | only the operator can do it (a click, a decision, a message they never finished) |
| `risk` | data or money is exposed (unpushed commits, secrets on disk, a wrong key) |
| `ask` | an agent asked the operator something and never got an answer |
| `open` | pending work nobody is driving |

A separate **Safe to close** section lists conversations that are finished or
empty. Ticks persist through the `artifact` capability (the page republishes
itself), with localStorage as the per-viewer fallback.

## Procedure

### 1. Enumerate active conversations

```bash
curl -s http://localhost:3011/api/conversations | python3 -c "
import sys,json; d=json.load(sys.stdin)
for c in d:
    if c.get('status')=='active': print(c['id'], c.get('harness'), c.get('projectKey'), c.get('lastActivityAt'), '|', c.get('title'))"
```

Skip conversations whose title is "New conversation" and whose transcript is
empty; list them under Safe to close as empty shells.

### 2. Dump each transcript

```bash
python3 {baseDir}/scripts/dump_conv.py <conv-id> > /path/to/scratch/conv-<id>.txt
```

The script handles claude-code JSONL (via `pan conversations jsonl`), Codex
rollouts under `~/.overdeck/agents/conv-<name>/codex-home/`, and OpenCode
sessions in `~/.local/share/opencode/opencode.db`. Output is `>>> USER [ts]`
and `--- ASST [ts]` blocks. Two traps:

- **Codex dumps are inflated.** Most `>>> USER` blocks are the harness's own
  approval-assessor prompts ("The following is the Codex agent history whose
  request action you are assessing"). Readers must count only real operator
  messages and use the approval blocks only as evidence of what ran.
- **Assistant blocks are truncated** (1500 chars by default). Where a reply is
  cut off, say so rather than guessing the conclusion.

### 3. Fan out readers

Spawn one `general-purpose` Agent per large conversation and group the small
ones (under ~30 KB) into one reader. Give each reader the dump path and this
contract:

> One entry per distinct topic the OPERATOR raised, chronological. Include
> side questions and small asks; merge repeated nudges on one topic. Per
> entry: topic in plain words, what the operator asked or decided, what the
> assistant did or concluded, STATUS (DONE / OPEN / WAITING ON OPERATOR /
> HANDED OFF to a named target), and any issue IDs, PRs, commits, paths.
> Then a DANGLING list: every ask with no completion evidence, every
> question the assistant asked that was never answered, and the last thing
> that happened with a verdict of settled or mid-task.

Ask readers to run read-only live checks (`gh issue view`, `pan show`) when a
transcript claims something was filed or landed, and to withhold secrets a
transcript may contain (API keys, passwords).

### 4. Compile

Keep only items that are still open. For each conversation write one line on
where it stopped, then the items with tags. Put loss risks (unpushed commits,
a possibly-submitted key reset, untracked PRDs) and mid-sentence operator
messages ("And also…") where they will be seen. Consolidate unanswered
agent questions into the `ask` tag rather than a separate list. Decide Safe
to close: finished, empty, or handed off to a successor conversation.

Save the compiled inventory to a scratch file before publishing so it
survives the session.

### 5. Publish

Copy `{baseDir}/assets/ledger-template.html` to the scratchpad, replace the
`GROUPS` array and the `CLOSEABLE` list with the compiled data, update the
stamp line, and publish:

```
Artifact file_path=<copy> favicon=🧵 capabilities={"artifact": {}}
       description="Every unfinished thread across your open Overdeck conversations, with checkboxes that save for everyone."
```

**Re-runs update the same page.** Find it with `Artifact action=list`,
`action=read` it, carry forward the ticked ids from its
`<script id="ledger-state">` block (item ids are `<conv>-<index>`, so keep
item order stable within a conversation when only appending), and publish
with `url=<existing>`. Never create a second ledger.

## Style rules for the page and the reply

- Link every issue ID on every occurrence (see the issue-references rule) and
  every conversation number as `https://overdeck.localhost/conv/<id>`.
- Plain language: name what a thread is, never a bare ID.
- Timestamps in UTC.
- In the terminal reply, lead with whichever thread the operator named, then
  the page link, then the loss risks. Do not reprint the whole ledger.
