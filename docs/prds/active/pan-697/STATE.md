# PAN-697 Planning — Root Artifact Cleanup

## Problem

The Overdeck repo root mixes canonical entrypoint files with stray audit reports,
historical writeups, and unused screenshots. The top level looks improvised rather
than intentional, which is a bad first impression for anyone opening the repo.

## Goal

Move stray root-level artifacts into purpose-specific homes under `docs/`, update
the one internal reference that breaks, and document a root-directory policy so
future contributors know where similar artifacts belong. No source-code or package
reorganization; no content rewrites.

## Discovery Findings

### Root artifacts to move (confirmed present)

Markdown (5):
- `AGENT_AUDIT_REPORT.md`
- `BUGS_FOUND.md`
- `gemini-gaps-found.md`
- `IMPLEMENTATION_SUMMARY.md`
- `PAN-428-CODEX-FEEDBACK.md`

Screenshots (9):
- `command-deck-full.png`, `command-deck.png`
- `composer-fullpage.png`, `composer-visible.png`
- `dashboard-home.png`
- `dropdown-narrow.png`, `dropdown-open.png`
- `final-dropdown-test.png`
- `normal-viewport.png`

### Reference impact (grep across repo, excluding node_modules/.venv/.git/planning/spec)

- **Markdown references:** only one real internal reference —
  `docs/AGENT_TYPES_INDEX.md:109` mentions `AGENT_AUDIT_REPORT.md` in prose.
  Must be updated to the new path under `docs/audits/`.
- **Screenshot references:** **zero**. All nine PNGs are orphan captures with no
  inbound links from any `.md`, `.mdx`, `.json`, `.ts`, `.tsx`, `.html`, or `.css`.
  Safe to move as a batch.

### Destination directories (none exist yet)

- `docs/audits/` — must be created
- `docs/history/` — must be created
- `docs/screenshots/root-cleanup/` — must be created (`docs/screenshots/` itself
  also does not exist)

### Stays at root (spec policy, unchanged)

Canonical entrypoints, standard metadata, and the intentional top-level `.mdx`
docs-site entries: `README.md`, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`,
`LICENSE`, `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`,
`tsdown.config.ts`, `vitest.config.ts`, `vitest.workspace.ts`, `typedoc.json`,
`commitlint.config.js`, `.gitignore`, `.gitattributes`, `.eslintrc.json`,
`.env.remote`, `introduction.mdx`, `quickstart.mdx`, `concepts.mdx`.

## Decisions

1. **History destination: `docs/history/`** — matches spec default; clearest
   "retained for context, not front door" signal.
2. **Screenshots destination: single batch to `docs/screenshots/root-cleanup/`** —
   since zero references exist, there's no ambiguity and no risk of broken links.
   Redistribution by feature would invent taxonomy for files nothing points at.
3. **Root policy lives in `docs/REPO-ARTIFACTS.md`** — the existing canonical
   artifact-policy doc. Extend it with a new "Repo root policy" section rather
   than creating a new top-level policy file (which would itself add to docs/
   clutter).
4. **Use `git mv`** for every move to preserve history (spec constraint).
5. **Out of scope:** other stray-looking root files not in the spec
   (`debug-review.mjs`, `excalidraw.log`, `devcontainer.json`, `docker-compose.devcontainer.yml`,
   `favicon.svg`, `docs.json`, `dev`). The spec is explicit about the file list;
   expanding scope mid-session would violate the no-drift rule.

## Approach

Five beads, each independently reviewable and mergeable:

1. **Move audit artifacts** to `docs/audits/` (3 files).
2. **Move historical writeups** to `docs/history/` (2 files).
3. **Move root screenshots** to `docs/screenshots/root-cleanup/` (9 files).
4. **Update the one broken reference** in `docs/AGENT_TYPES_INDEX.md`.
5. **Document the root-directory policy** by extending `docs/REPO-ARTIFACTS.md`.

Beads 1-3 are independent and can land in any order. Bead 4 depends on bead 1
(new path must exist). Bead 5 is independent and can land in parallel.

## Acceptance (feature-level)

- Root directory no longer contains any of the 14 listed artifacts.
- All 14 files are reachable under `docs/` at the decided destinations with git
  history preserved.
- `docs/AGENT_TYPES_INDEX.md` references the new audit-report path.
- `docs/REPO-ARTIFACTS.md` contains a "Repo root policy" section stating what
  belongs at root and where audits/history/screenshots go.
- No other repo behavior changes; `npm run typecheck`, `npm run lint`,
  `npm test` all pass (these shouldn't be affected at all).

## Risks

- **Low overall.** File moves are mechanical and the reference surface is tiny.
- Only real risk: missing a markdown image link that wasn't caught by grep
  (e.g. split across lines). Mitigation: the reference-update bead includes a
  final grep sweep for the old basenames before marking complete.
