---
name: conv-lookup
description: Find, review, read, inspect, summarize, or compare Overdeck conversations. Use when the user references a pan.localhost/conv/<id> URL, a conversation ID (e.g. "conv 371", "conversation 108"), a fuzzy reference ("that GPT conversation", "the last Sonnet session"), or asks to review/read/look at/check/summarize/compare conversations. Maps conversation IDs to Claude Code JSONL session files and parses session content. Read-only.
triggers:
  - review conversation
  - read conversation
  - look at conversation
  - look at that conversation
  - check conversation
  - inspect conversation
  - summarize conversation
  - compare conversations
  - what was in conversation
  - that conversation
  - pan.localhost/conv
  - conv/
  - conv 
  - conversation
---

# Conversation Lookup

Use this skill whenever the user references a Overdeck conversation — by `pan.localhost/conv/<id>` URL, numeric id, conversation name, or a fuzzy reference like "that GPT conversation". Handles single-conversation review, recent-conversation listing, search, and side-by-side comparison.

## When to use

- User asks about a specific conversation ID (e.g., "check conv/108", "what was happening in conversation 42?")
- User pastes a `https://pan.localhost/conv/<id>` URL and asks you to review, read, or look at it
- User wants to compare two conversations (e.g., voice/style diff across models)
- User wants to resume or summarize a past conversation
- User asks for recent conversation history
- Need to find the JSONL session file for a conversation to analyze its content

> **Do not** try `WebFetch` on `pan.localhost/conv/<id>` — the dashboard is an SPA and WebFetch will return empty page chrome. Always go through the script / `pan conv` CLI.

## "Which conversation am I in?"

If you are an agent inside a conversation and need to know *your own*
conversation (e.g. to hand it off), **do not** run `pan conv scan` / `list` /
`show` and guess. Run:

```bash
pan conv current   # alias: pan conv whoami
```

This resolves the current conversation deterministically from the session you
are running in (PAN-1520) — no guessing. To hand off or fork your own
conversation, just omit `<conv>`: `pan handoff` / `pan fork` self-detect the
same way.

## How it works

Conversation and session state lives in the Overdeck SQLite database, but **this skill never reads that DB directly** — the DB location (`~/.overdeck/overdeck.db`) and its schema (UUID conversation ids, `claude_session_id` in `conversation_files`, etc.) are not a stable contract and have already shifted once across the rebrand (PAN-2019). Instead, everything routes through the canonical `pan conv` CLI read door, which is schema-stable:

```bash
pan conv jsonl <id>        # alias: pan conv transcript <id>
pan conv jsonl --json <id>
pan conv show --json <id>   # conversation metadata (PAN-2018: conversation-first)
pan conv list --format json # discovered sessions
```

`pan conv jsonl` is the canonical resolver. It reads the conversation's `claude_session_id` + `cwd`, resolves through the shared Overdeck transcript-path helper, preserves the one-level `~/.claude/projects/*/<session-id>.jsonl` fallback, and reports one of:

- `ok` — path exists on disk
- `expired` — Claude session id is known, but the JSONL is not present on disk
- `unknown` — no `claude_session_id` is recorded for this conversation

`conv-find.py --jsonl <id>` delegates to `pan conv jsonl --json <id>`; do not reimplement path encoding, derivation, or glob fallback in the skill script.

**The `session_file` column is deprecated (PAN-451) and NULL for all conversations created since 2026-05.** Never conclude "no session file recorded" from a NULL `session_file` — resolve through `pan conv jsonl` instead.

Plain `pan conv jsonl <id>` prints the absolute path to stdout and exits 0 only when status is `ok`; it exits 1 for `expired` and `unknown`. `pan conv jsonl --json <id>` always prints a JSON object containing `status`, `path`, `conversationId`, `claudeSessionId`, and `cwd`; read the `status` field rather than the process exit code in JSON mode.

## Running commands

The script is at the root of this skill directory. Always run it from any working directory.

### Find a specific conversation

```bash
python3 scripts/conv-find.py <id>
```

Example output:
```text
Conversation #108
  Name:          20260412-4175
  Status:        ended
  Model:         claude-opus-4-6
  Effort:        medium
  CWD:           ~/Projects
  Issue:         N/A
  Title:         Lexerra game rules query out of scope
  Cost:          $22.90
  Created:       2026-04-12T01:44:30.908Z
  Ended:         2026-04-12T17:00:06.619Z
  Session file:  ~/.claude/projects/<project-hash>/<session-id>.jsonl

  Session messages: 130
  By role:        assistant=62, user=68
  Tool uses:      41
  First prompt:   I don't have any information about a game called "Lexerra"...
  Last prompt:    That means the new code is running but still producing nonsense words...
  Last assistant: I traced the remaining nonsense generation to...
```

The Name/Status/Model/Title/Cost fields come from `pan conv show --json`. On
main branches predating PAN-2018, `show` returns session-only data and these
fields show `N/A` (the script falls back to `pan conv jsonl` for id / cwd /
transcript); they populate automatically once PAN-2018 lands.

### Get only the JSONL path

Prefer the canonical resolver directly:

```bash
pan conv jsonl 108
pan conv transcript 108   # alias
```

The skill helper delegates to the same command:

```bash
python3 scripts/conv-find.py --jsonl 108
```

### Print a normalized summary of recent notable messages

```bash
python3 scripts/conv-find.py --summary 108
```

This includes recent messages with:
- line number in the JSONL
- role
- tool names used in that message
- normalized text snippet

### Output machine-readable JSON

```bash
python3 scripts/conv-find.py --json 108
python3 scripts/conv-find.py --recent 20 --json
python3 scripts/conv-find.py --search gpt-5.4 --json
```

For a single conversation, `--json` includes:
- conversation metadata (resolved through `pan conv show --json`; falls back to the `pan conv jsonl` resolver on older main)
- a `session_summary` object with normalized session info parsed from the transcript

### List recent sessions

```bash
python3 scripts/conv-find.py --recent 20   # default 20
```

### Search by model / workspace / tools / files

Search is a client-side substring filter over `pan conv list --format json` (there is no CLI search door yet). It matches across primary model, workspace path, issue id, summary, models used, tools used, and files touched:

```bash
python3 scripts/conv-find.py --search lexerra
python3 scripts/conv-find.py --search gpt-5.4
```

## Session parsing behavior

The script now tolerates the JSONL message shape variations seen in real Claude Code sessions.

### Supported shapes

`message.content` may be:
- a plain string
- a list of strings
- a list of typed blocks

Typed blocks may include:
- `text`
- `thinking`
- `tool_use`
- `tool_result`

The parser normalizes these into:
- text fragments
- tool names
- role/timestamp/line metadata

## Parsing session content manually

If you still need custom parsing, do not assume `message.content` is always a list of dict blocks.

```python
import json, pathlib

path = pathlib.Path(session_file)
for line in path.read_text().splitlines():
    if not line.strip():
        continue
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue
    msg = obj.get("message")
    if not isinstance(msg, dict):
        continue
    content = msg.get("content")
    # content may be a string, list[str], or list[dict]
```

## Do not query the DB directly

There is no stable contract for the on-disk DB path or the `conversations`
schema, and both have already changed once (rebrand: `~/.panopticon` →
`~/.overdeck`; schema: integer → UUID ids, `claude_session_id` moved into
`conversation_files`). Direct SQL against the DB is what broke this skill in
the first place (PAN-2019).

Use the CLI doors instead:

```bash
pan conv jsonl --json <id>      # transcript path + claudeSessionId + cwd
pan conv show --json <id>       # conversation metadata (PAN-2018)
pan conv list --format json     # discovered sessions
pan conv current --json         # the conversation you are running in
```

If you genuinely need a raw DB inspection for debugging (not for resolving a
conversation), prefer the dashboard's read API (`GET /api/conversations/<id>`)
or the `pan conv` doors over hand-written SQL — the DB is a disposable cache
rebuilt from durable sources.

## Comparing two conversations

When the user wants a voice/approach/regression diff between two conversations:

1. Resolve both via `python3 scripts/conv-find.py --json <id>` to get `resolved_session_file`, `session_file_status`, and `model`.
2. Extract readable text from each resolved session file (use `--summary`, or jq for full text).
3. Present side-by-side labelled by model, so style differences are obvious.

Typical use cases: "how did GPT-5.4 handle this vs Sonnet?", "compare conv 365 and 366", "why does the GPT version feel clunkier?".

## See Also

- `unarchive-conversation` — restore an archived Overdeck conversation to active state (write operation; use this if the conversation you're reviewing is archived and you want it live in Mission Control)
- `pan show <id>` — inspect agent state for *issue* work (different scope — agents working on issues, not user conversations)
