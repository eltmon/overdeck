---
scope: universal
---
### `pan handoff` focus: keep it short; the hard ceiling is 10,000 chars

The `pan handoff` **focus** (the trailing text after `self`/`<conv>`) is a steering
statement, not the brief. Since PAN-3737 the hard cap is **10,000 characters**
(multi-line focus is allowed), so accidental rejection is effectively gone — but a
short focus still works better: it becomes the conversation title and steers the
handoff author, while detail belongs in the transcript or a brief file.

For a full brief, write it to a file in the target cwd and point the focus at it:

```bash
pan handoff self "Read .pan/handoff-brief.md FIRST and follow it exactly. <one-line goal>"
```

Also pass **`self`** (or a real conversation id) **before** the focus text. Omitting it
makes the CLI read your focus as a conversation name and fail with `Conversation not found`.

**Why:** the old 500-char cap rejected the handoff *after* the agent had done the work,
on essentially every long focus, burning retry loops. The cap is now a sanity ceiling
only; the file-backed brief remains the reliable pattern for long instructions.
