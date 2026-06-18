# PAN-697: Root Artifact Cleanup

## Problem Statement

The Overdeck repository root currently mixes canonical entrypoint files with screenshots, audit notes, exploratory writeups, implementation summaries, and other one-off artifacts. Even when those files are committed and historically useful, their presence at the top level makes the repo look improvised instead of intentional.

For a seasoned developer opening the repository, the root should immediately answer:
- what this project is,
- how to install or use it,
- where source code lives,
- where product docs live,
- where design/media assets live.

Everything else should live in a clearly named home.

This cleanup is about professional presentation and navigability, not deleting history.

## Requirements

### Must Have

- Create and follow an explicit root-directory policy for Overdeck.
- Keep true root-level entrypoint files at root.
- Move root-level stray markdown and image artifacts into intentional subdirectories.
- Update all internal references that break because of file moves.
- Preserve git history by moving committed files rather than deleting and recreating them.
- Avoid deleting useful historical material during this cleanup.
- Leave repo behavior unchanged apart from file organization and reference updates.

### Should Have

- Group moved artifacts by purpose rather than by file extension alone.
- Make the top-level directory look clean to an experienced open-source maintainer or staff engineer scanning the repo.
- Document the policy well enough that future contributors know where similar artifacts belong.

### Out of Scope

- Source-code reorganization.
- Package/workspace restructuring.
- Large content rewrites of existing docs.
- Broad docs IA redesign outside what is necessary to house moved root artifacts.
- Deleting valuable historical documents because they are “ugly” or old.

## Design

### User Experience

A developer opening the repository root should see a short, professional list of expected items:
- canonical repo docs (`README.md`, `CLAUDE.md`, `AGENTS.md`, possibly `CONTRIBUTING.md`),
- package/build metadata (`package.json`, lockfile, tsconfig, lint config, etc.),
- source and product directories (`src/`, `packages/`, `docs/`, `scripts/`, `tests/`, `images/`, `design/`, etc.).

They should **not** see a pile of ad hoc screenshots, audit reports, feedback notes, or temporary-seeming summaries in the root.

### Technical Approach

#### 1. Root policy: what stays at root

These stay at root because they are canonical repository entrypoints or standard project metadata:

- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `CONTRIBUTING.md`
- `LICENSE`
- `package.json`
- `bun.lock`
- `bunfig.toml`
- `tsconfig.json`
- `tsdown.config.ts`
- `vitest.config.ts`
- `vitest.workspace.ts`
- `typedoc.json`
- `commitlint.config.js`
- `.gitignore`
- `.gitattributes`
- `.eslintrc.json`
- `.env.remote`
- intentional top-level docs-site entry pages already wired from repo root:
  - `introduction.mdx`
  - `quickstart.mdx`
  - `concepts.mdx`

Notes:
- The `.mdx` pages stay because current docs configuration and prior planning artifacts indicate they intentionally live at root.
- `commitlint.config.js` stays because root tool config is normal and professional.

#### 2. Root artifacts to relocate

These currently clutter the root and should move to purpose-built homes.

##### Root markdown artifacts to move

- `AGENT_AUDIT_REPORT.md`
- `BUGS_FOUND.md`
- `IMPLEMENTATION_SUMMARY.md`
- `PAN-428-CODEX-FEEDBACK.md`
- `gemini-gaps-found.md`

##### Root screenshots/images to move

- `command-deck-full.png`
- `command-deck.png`
- `composer-fullpage.png`
- `composer-visible.png`
- `dashboard-home.png`
- `dropdown-narrow.png`
- `dropdown-open.png`
- `final-dropdown-test.png`
- `normal-viewport.png`

#### 3. Destination policy

Move by purpose, not by extension.

##### Audits / investigations / findings

Preferred home:
- `docs/audits/`

Target candidates:
- `AGENT_AUDIT_REPORT.md`
- `BUGS_FOUND.md`
- `gemini-gaps-found.md`

Rationale:
- These are not user-facing entrypoint docs.
- They are investigation outputs / findings documents.
- `docs/audits/` communicates that they are retained for reference, not part of the root narrative.

##### Historical implementation / migration summaries / external-feedback writeups

Preferred home:
- `docs/history/` or `docs/notes/`

Initial intent for this cleanup:
- Create **one** intentional home rather than scattering these.
- Default to `docs/history/` if the content is mainly historical/contextual.

Target candidates:
- `IMPLEMENTATION_SUMMARY.md`
- `PAN-428-CODEX-FEEDBACK.md`

Rationale:
- These are historically useful but should not be root-level front door docs.

##### Screenshots tied to docs or cleanup evidence

Preferred home:
- `docs/screenshots/root-cleanup/` for historical cleanup/reference screenshots
- or `images/` only if the images are part of the public docs/site taxonomy

Initial intent for this cleanup:
- Put the current root-level screenshots under `docs/screenshots/root-cleanup/` unless a given image is actively used as a product-doc asset and belongs under `images/` or `docs/`.

Target candidates:
- `command-deck-full.png`
- `command-deck.png`
- `composer-fullpage.png`
- `composer-visible.png`
- `dashboard-home.png`
- `dropdown-narrow.png`
- `dropdown-open.png`
- `final-dropdown-test.png`
- `normal-viewport.png`

Rationale:
- These look like captured verification or design-reference screenshots, not canonical repo-root assets.
- Root should not be a screenshot gallery.

#### 4. Reference update pass

After moving files:
- search the repo for old paths,
- update references in markdown/docs/config,
- verify that README/docs image links still resolve,
- verify that no tooling expects the moved files at the old root paths.

#### 5. Professionalism rule for future additions

As part of this cleanup, document or encode the following rule in the PRD/implementation notes:

> The repo root is reserved for canonical entrypoint docs, standard project metadata, and first-class project directories. Audit artifacts, screenshots, exploratory writeups, and historical notes must live under a purpose-specific subdirectory.

### Constraints

- Preserve committed history with `git mv`-style moves where possible.
- Do not move files that are intentionally used as top-level docs-site entrypoints without explicit evidence they should move.
- Do not silently delete historical documents during cleanup.
- Keep naming clear and boring; avoid clever taxonomy.
- The result must feel conventional and professional to an experienced developer.

## References

- Related issue: PAN-697
- Existing root artifacts observed in current repo root:
  - markdown: `AGENT_AUDIT_REPORT.md`, `BUGS_FOUND.md`, `IMPLEMENTATION_SUMMARY.md`, `PAN-428-CODEX-FEEDBACK.md`, `gemini-gaps-found.md`
  - screenshots: `command-deck-full.png`, `command-deck.png`, `composer-fullpage.png`, `composer-visible.png`, `dashboard-home.png`, `dropdown-narrow.png`, `dropdown-open.png`, `final-dropdown-test.png`, `normal-viewport.png`
- Canonical docs/site entry pages currently at root:
  - `introduction.mdx`
  - `quickstart.mdx`
  - `concepts.mdx`
- Existing screenshot conventions already in repo:
  - `docs/screenshot-board.png`
  - `design/screenshots/`
  - `images/` and feature-specific image folders
- Existing artifact/reference documentation:
  - `docs/REPO-ARTIFACTS.md`
  - `docs/INDEX.md`

## Open Questions

- Should historical writeups live under `docs/history/`, `docs/notes/`, or another existing docs bucket?
- Should all moved screenshots go under `docs/screenshots/root-cleanup/`, or should some be redistributed into existing feature/design image directories?
- Should this issue also add a short contributor note describing where future audit reports and screenshots belong, or is the reorganization itself sufficient?
