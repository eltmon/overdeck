---
name: conv-lookup
description: Find Panopticon conversations by ID, search by title/cwd/model, or list recent. Maps conversation IDs to their Claude Code JSONL session files and parses session content.
---

# Conversation Lookup

Use this skill to find Panopticon conversations when a user references a `pan.localhost/conv/<id>` URL or conversation number.

## When to use

- User asks about a specific conversation ID (e.g., "check conv/108", "what was happening in conversation 42?")
- User wants to resume a past conversation
- User asks for recent conversation history
- Need to find the JSONL session file for a conversation to analyze its content

## How it works

Every Panopticon conversation is tracked in the SQLite database at `~/.panopticon/panopticon.db` in the `conversations` table. Each row maps to a Claude Code JSONL session file in `~/.claude/projects/-home-eltmon-Projects/`.

## Running commands

The script is at the root of this skill directory. Always run it from any working directory.

### Find a specific conversation

```bash
python3 scripts/conv-find.py <id>
```

Example output:
```
Conversation #108
  Name:          20260412-4175
  Status:        ended
  Model:         claude-opus-4-6
  Effort:        medium
  CWD:           /home/eltmon/Projects
  Issue:         N/A
  Title:         Lexerra game rules query out of scope
  Cost:          $22.90
  Created:       2026-04-12T01:44:30.908Z
  Ended:         2026-04-12T17:00:06.619Z
  Session file:  /home/eltmon/.claude/projects/-home-eltmon-Projects/9b714cc0.jsonl

  Session messages: 130
  First prompt: I don't have any information about a game called "Lexerra"...
  Last prompt:  That means the new code is running but still producing nonsense words...
```

### Get only the JSONL path (for further parsing)

```bash
python3 scripts/conv-find.py --jsonl <id>
```

### List recent conversations

```bash
python3 scripts/conv-find.py --recent 20   # default 20
```

### Search by title/cwd/model

```bash
python3 scripts/conv-find.py --search lexerra
python3 scripts/conv-find.py --search gpt-5.4
```

## Parsing session content

Once you have the JSONL path, parse it to find user prompts, assistant responses, and tool usage:

```python
import json, pathlib

path = pathlib.Path(session_file)  # from conv-find.py
for line in path.read_text().splitlines():
    if not line.strip():
        continue
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue
    msg = obj.get('message', {})
    if not msg:
        continue
    role = msg.get('role', '')
    content = msg.get('content', [])
    # content is a list of blocks with type: "text", "tool_use", "tool_result"
```

**Message format**: Each line is a JSON object with a `message` field (or no `message` for system events). The `message.content` is a list of blocks:
- `{"type": "text", "text": "..."}`
- `{"type": "tool_use", "name": "...", "input": {...}}`
- `{"type": "tool_result", "content": [{"type": "text", "text": "..."}]}`

## Key database columns

The `conversations` table has these useful columns:
- `id` — numeric conversation ID (the number in `/conv/<id>`)
- `name` — Panopticon-generated name (e.g., `20260412-4175`)
- `status` — `active` or `ended`
- `cwd` — working directory when spawned
- `issue_id` — associated issue (null for manual convs)
- `session_file` — full path to the JSONL session file
- `title` — auto/AI-set title from first message
- `title_seed` — original user message that started the conversation
- `total_cost` — cached total cost in USD
- `model` — model used (e.g., `claude-opus-4-6`, `gpt-5.4`)
- `effort` — effort level (`low`, `medium`, `high`)
- `created_at`, `ended_at` — timestamps

## Quick SQL queries

For direct database queries:
```bash
# Find conversation by ID
sqlite3 ~/.panopticon/panopticon.db "SELECT id, name, status, session_file, title, model, created_at FROM conversations WHERE id = 108;"

# Search by keyword in title
sqlite3 ~/.panopticon/panopticon.db "SELECT id, session_file, title FROM conversations WHERE title LIKE '%lexerra%';"
```
