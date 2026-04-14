# PAN-705: Command Taxonomy Reorganization

**Status:** Planning complete
**Authoritative sources:**
- `docs/prds/planned/pan-command-taxonomy-reorg.md` — phase plan, exit criteria, acceptance
- `docs/QUICK-REFERENCE.md` — target surface + legacy→new migration table

Both documents exist uncommitted in this worktree. The first work-agent commit on
`feature/pan-705` must `git add` them.

---

## Problem

`pan`'s top-level command surface grew organically and no longer maps to how users
think about work. `pan work` is a junk drawer mixing lifecycle, runtime, review,
state queries, and internal hooks. Plumbing (`cloister`, `specialists`, `beads`,
`db`, `remote`, `migrate-config`) clutters the happy path. The Claude Code skill
surface has drifted from the CLI: no umbrella `/pan`, ~60 ad-hoc `pan-*` skills,
narrative descriptions that fuzzy-search can't find.

## Decision (per PRD)

Five-bucket taxonomy + `pan admin` plumbing namespace. Clean break — no
muscle-memory aliases. Dashboard UI is **in scope** for route renames, string
replacement, and a first-launch upgrade banner (added in Phase 4.5). Skill
surface aligns 1:1 with the new CLI verbs. Pre-1.0 minor version bump.

Full verb list, migration table, and exit criteria in the PRD and quick-ref.

## Scope anchors

- **Bead granularity:** aggressive decomposition per user directive. One collapsed
  command = one bead. One renamed verb = one bead. One admin group moved = one
  bead. One route rename = one bead. One skill-alignment substep = one bead.
  Phases are organizational scaffolding, not bead boundaries.
- **Snapshot test convention (new for the repo):** plain-text fixtures at
  `tests/fixtures/pan-help.txt` and `tests/fixtures/synced-skills.txt`. Vitest
  asserts byte-for-byte equality. Update path: `UPDATE_FIXTURES=1 vitest run`.
  Rationale: human reviewers need to eyeball drift in PR diffs; `.snap` files
  are unreadable. Outputs are fully deterministic so no normalization needed.
  This establishes the convention for locking any user-facing text surface in
  the future.
- **Umbrella `/pan` skill** dispatches args via the Bash tool (`pan <args>` as
  a single invocation). Taxonomy is embedded in `SKILL.md` as a cheat sheet —
  no runtime filesystem reads. Destructive verbs (`wipe`, `kill`, `close`,
  `approve`, `admin cloister emergency-stop`) require chat-layer confirmation
  before the Bash call. Shell metacharacters in user args are refused. Unknown
  verbs print the cheat sheet + nearest-match suggestion instead of blindly
  executing. Flat shortcut skills share a template at
  `.claude/skills/_template/pan-verb-skill.md`.
- **Dashboard routes:** `/api/work/*` splits into `/api/issues/*`,
  `/api/review/*`, `/api/show/*`, `/api/admin/*`. Contracts update propagates
  through `packages/contracts/` → Effect RPC group → frontend client. No legacy
  route shims. Existing integration tests updated in lockstep.

## Pipeline handoff notes for specialists

Specialists run outside the workspace and don't see this file. The vBRIEF
acceptance criteria are the source of truth for review/inspect/uat.

**Inspect agent (per-bead verification):**
- Each phase-2/3/4 bead has a "grep the tree for legacy invocation" AC to stop
  half-migrated state from sliding through.

**Review agent:**
- Enforce the plain-text fixture convention. If a bead introduces a
  `.snap` file, reject it and point at `tests/fixtures/*.txt` pattern.
- Enforce `pan show <id>` default view ≤ 25 lines. The PRD calls this out
  explicitly as a risk mitigation.
- Verify no `pan work` references remain at end of Phase 3 closure bead.
- Verify no legacy `/api/work/*` routes or `pan-work-*` skill files remain at
  end of Phase 4.5 and Phase 5.5 closure beads.

**Test agent:**
- Ensure `tests/fixtures/pan-help.txt` and `tests/fixtures/synced-skills.txt`
  exist and match. Test file must document the `UPDATE_FIXTURES=1` env var.

**UAT:**
- `/pan` in Claude Code surfaces the umbrella skill (not "Unknown skill").
- `/pan start PAN-415` actually starts an agent via Bash.
- Dashboard first-launch banner renders the migration table on first visit
  after upgrade and persists dismissal in localStorage.

**Merge:**
- Minor version bump (0.x+1.0). CHANGELOG entry includes the full migration
  table. Standard `postMergeLifecycle` cleanup.

## Out of scope (confirmed from PRD)

- Renaming the `pan` binary.
- Config file format changes.
- Issue ID parsing (`flexible-tracker-id-resolution` PRD).
- Dashboard component redesign / new views / layout changes.
- CLI → TUI conversion.
