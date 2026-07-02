---
scope: universal
---
### `pan handoff` focus is capped at 500 chars — put long briefs in a file

The `pan handoff` **focus** (the trailing text after `self`/`<conv>`) is hard-capped at **500 characters**. A longer focus is rejected outright — the CLI prints `Focus is N characters — the limit is 500` and **creates no conversation**. Do not try to cram a full brief into the focus.

For anything longer than one line, write the full brief to a file in the target cwd and point a short focus at it:

```bash
pan handoff self "Read .pan/handoff-brief.md FIRST and follow it exactly. <one-line goal>"
```

Also pass **`self`** (or a real conversation id) **before** the focus text. Omitting it makes the CLI read your focus as a conversation name and fail with `Conversation not found`.

**Why:** agents repeatedly overrun the 500-char focus and the handoff silently fails to spawn (this has happened on essentially every handoff attempt). A file-backed brief makes the handoff reliable regardless of length, and keeps the full instructions in the new conversation's cwd where it can re-read them.
