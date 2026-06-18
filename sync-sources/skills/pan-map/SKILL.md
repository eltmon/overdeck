---
name: pan-map
description: "Topical: bootstrap or refresh Overdeck codebase map files for project orientation before planning"
---

# Overdeck Codebase Map

Use this skill when a project needs durable orientation files before or during planning. There is no `pan map` CLI verb; the deliverable is committed markdown under `.pan/context/codebase/`.

## Goal

Create or refresh these four files:

- `.pan/context/codebase/architecture.md` — subsystems, entry points, data flow, key directories.
- `.pan/context/codebase/conventions.md` — naming, style, test placement, idioms agents must imitate.
- `.pan/context/codebase/concerns.md` — cross-cutting traps, async-only rules, known footguns, hazard list.
- `.pan/context/codebase/stack.md` — languages, frameworks, package manager, build/test commands, versions.

Each file should be an orientation digest, not full documentation:

- Keep each file to roughly 150 lines or fewer.
- End each file with `<!-- last-verified: YYYY-MM-DD -->`.
- Prefer stable facts and conclusions over broad file listings.
- Update stale statements and the `last-verified` date when you confirm a change.

## Workflow

1. Read existing `.pan/context/codebase/` files if present.
2. Explore only enough code to confirm architecture, conventions, concerns, and stack.
3. Write or refresh all four files together so they stay internally consistent.
4. Commit the map with the project changes that introduced or refreshed it.

Planning agents consume these files first and refresh them during discovery when they find stale content.
