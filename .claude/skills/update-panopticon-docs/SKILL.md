---
name: update-panopticon-docs
version: "2.0.0"
description: Compatibility wrapper that points Panopticon documentation work to pan-docs
compatibility: Claude Code 2.1.0+
triggers:
  - update panopticon docs
  - modify panopticon documentation
  - edit panopticon readme
  - update configuration docs
---

# Update Panopticon Docs Skill

This skill now exists as a **compatibility wrapper**.

Use `pan-docs` as the primary Panopticon documentation skill for:
- finding docs
- deciding where docs should live
- updating docs with the right audience and abstraction level
- keeping `docs/INDEX.md` current

## What to do

1. Invoke or follow `pan-docs`.
2. Use these supporting resources when needed:
   - `resources/STYLE_GUIDE.md`
   - `resources/DOC_LOCATIONS.md`
   - `resources/EXAMPLES.md`
3. Use `clear-writing` only for general prose cleanup after the Panopticon-specific structure is right.

## Why this wrapper exists

Older prompts and habits may still reference `update-panopticon-docs`.
Keeping this wrapper avoids breakage while making `pan-docs` the single consistent documentation skill surface.

## Version History

- 2.0.0 (2026-04-17): Converted to compatibility wrapper; `pan-docs` is now the primary docs skill
- 1.0.0 (2026-01-28): Initial skill creation with documentation index
