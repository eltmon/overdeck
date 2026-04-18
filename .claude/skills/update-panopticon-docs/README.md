# Update Panopticon Docs Skill

Compatibility wrapper for older references to the Panopticon documentation skill.

## Status

`update-panopticon-docs` is no longer the primary documentation skill.

Use **`pan-docs`** for Panopticon documentation work.
This wrapper remains so older prompts and habits still land in the right place.

## What lives here

This directory now exists mainly to hold the shared documentation resources used by `pan-docs`:
- `resources/STYLE_GUIDE.md` — Panopticon documentation philosophy and style
- `resources/DOC_LOCATIONS.md` — where different kinds of documentation belong
- `resources/EXAMPLES.md` — common update patterns

## Primary workflow

When working on Panopticon documentation:
1. start with `pan-docs`
2. use the resources in this directory as supporting references
3. use `clear-writing` only for general prose cleanup after the structure is right

## Sync

These resources are project-local and can be synced through the normal Panopticon skill flow (`pan sync`).

## Version

Current version: 2.0.0
