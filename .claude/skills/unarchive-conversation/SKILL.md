---
name: unarchive-conversation
description: Restore an archived Panopticon conversation by exact conversation name or by matching archived title. Use when the user asks to unarchive, restore, bring back, or reopen a Claude/Panopticon conversation such as "unarchive Models, Models, Models".
triggers:
  - unarchive conversation
  - restore conversation
  - bring back conversation
  - reopen conversation
  - unarchive archived chat
  - restore archived chat
allowed-tools:
  - Bash
  - Read
---

# unarchive-conversation

Run the command now:

```bash
pan unarchive-conversation <query>
```

## Usage

```bash
pan unarchive-conversation "Models, Models, Models"
pan unarchive-conversation conv-153
```

## What It Does

Restores an archived conversation to the active Panopticon conversation list.

The command first checks for an exact archived conversation name match, then looks for archived title matches. If more than one archived conversation matches the title, it refuses and prints the matching conversation names so you can disambiguate safely.

## When to Use

- A conversation was archived accidentally
- The user wants an old conversation back in Mission Control
- You know the title but not the internal conversation name

## Notes

- This only unarchives; it does not resume or respawn the tmux session
- If the conversation is already active, the command reports that and makes no change
- Prefer the exact conversation name when multiple archived titles are similar

## See Also

- `pan unarchive-conversation <query>` — restore the archived conversation
- `conv-lookup` — find, read, or review a Panopticon conversation (works on archived ones too — the session file is always readable; only unarchive when you need it live in Mission Control)
- `pan show <id>` — inspect agent state for issue work
- `pan status` — check running agent sessions
