---
name: pan-docs
description: Find, update, and structure Panopticon documentation using the docs index and documentation guide
author: Panopticon
version: 2.0.0
triggers:
  - panopticon docs
  - find in panopticon docs
  - where is documentation for
  - panopticon documentation
  - pan docs
  - update docs
  - update panopticon docs
allowed-tools:
  - Read
  - Grep
  - Glob
  - Edit
---

# Pan-Docs Skill

**Purpose:** Be the single Panopticon-specific skill for finding, updating, and improving documentation.

Use this skill for three kinds of work:
- answering questions from existing docs
- deciding where new documentation should live
- updating docs so they stay newcomer-friendly, consistent, and discoverable

This is the primary Panopticon documentation skill. If you need general prose cleanup, use `clear-writing` as a supporting skill, not as a replacement for Panopticon-specific documentation judgment.

---

## Core Rules

1. **Start with the docs index.** Use `docs/INDEX.md` before guessing where information lives.
2. **Write for the reader who is new to Panopticon.** Lead with purpose and mental model before code paths or implementation details.
3. **One document should do one job well.** Keep overview docs, routing references, workflow guides, and implementation deep dives distinct.
4. **Prefer linking over duplicating.** If another doc already owns the detail, summarize briefly and point there.
5. **Keep the index current.** If docs coverage changes, update `docs/INDEX.md` too.

For the full writing philosophy and maintenance guidance, read:
- `.claude/skills/update-panopticon-docs/resources/STYLE_GUIDE.md`
- `.claude/skills/update-panopticon-docs/resources/DOC_LOCATIONS.md`
- `.claude/skills/update-panopticon-docs/resources/EXAMPLES.md`

---

## Workflow

### 1. Find the right document
Read `docs/INDEX.md` first.

Use:
- category tables to find the owning document
- Topic Quick-Find to find likely matches by keyword

If the index is not enough, grep the docs tree.

### 2. Decide the document type before editing
Ask what kind of document this is:
- **Overview doc** — newcomer mental model first
- **Reference doc** — lookup table or canonical options
- **Workflow doc** — how stages interact over time
- **Implementation deep dive** — internals and code-shaped detail

Do not mix these levels unless the file already clearly does one job.

### 3. Update the target document
When editing:
- preserve the file's existing role
- up-level docs that drift into code-audit detail when they are meant to orient newcomers
- keep terminology consistent with neighboring docs
- add links to related docs instead of repeating their full content

### 4. Update the index
Whenever documentation coverage changes:
- add new files to `docs/INDEX.md`
- update descriptions if a file's role changed
- add or adjust Topic Quick-Find keywords when new topic coverage appears

### 5. Verify the docs surface
After editing, check:
- the file still matches its intended audience and abstraction level
- links point to the right owner docs
- `docs/INDEX.md` still helps someone find the topic

---

## Common Uses

### Answer a docs question
1. Read `docs/INDEX.md`
2. Read the identified file(s)
3. Answer with file references

### Add or update documentation
1. Identify the owning document type
2. Read the full file before editing
3. Keep the explanation at the right level for that doc
4. Update `docs/INDEX.md` if discoverability changed

### Clean up confusing docs
When a doc feels too low-level for its audience:
- keep exact implementation details in the deeper doc
- rewrite the overview to explain what exists, when it appears, and why it matters
- add links to the deeper reference instead of embedding the full internals

---

## Quick Pointers

| Need | Start here |
|------|------------|
| Find documentation | `docs/INDEX.md` |
| Documentation philosophy | `.claude/skills/update-panopticon-docs/resources/STYLE_GUIDE.md` |
| Where docs belong | `.claude/skills/update-panopticon-docs/resources/DOC_LOCATIONS.md` |
| Common update patterns | `.claude/skills/update-panopticon-docs/resources/EXAMPLES.md` |
| General prose cleanup | `clear-writing` |

---

## When docs are missing

If the index and docs search do not reveal coverage:
1. confirm the topic is really missing
2. choose the smallest correct owning doc
3. add the documentation there
4. update `docs/INDEX.md` so the topic is findable next time
