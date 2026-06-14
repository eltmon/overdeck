# PAN-1883 — Pipeline truth lives in SQLite/API, never the legacy review-status.json

**Status:** in progress on `main` (operator-authorized direct implementation, 2026-06-14).
**Scope:** immediate. Executed together with PAN-1877 and PAN-1884.
**Supersedes:** the original PAN-1883 framing ("review-status.json is canonical and got wiped"), which is **factually false** — see Background.
**Audit basis:** [`docs/STATE-STORAGE-AUDIT.md`](../../docs/STATE-STORAGE-AUDIT.md)

> **Executor note (read first).** File paths verified against the repo at authoring (2026-06-14);
> **line numbers may drift** — each change quotes a search anchor; use the search string as the
> primary locator. Do not infer behavior — open the file and confirm before editing.

---

## Background (why this issue changed)

The original PAN-1883 claimed `~/.panopticon/review-status.json` is the canonical review-status store
and that a wipe stranded 11 in-review issues. **Both claims are false**, verified:

- `src/lib/review-status.ts` — `loadReviewStatuses()` returns `getAllReviewStatusesFromDb()` (search
  `getAllReviewStatusesFromDb`). **SQLite (`~/.panopticon/panopticon.db`, table `review_status`) is
  authoritative.** The deacon/server never read the JSON file.
- `src/lib/review-status-json.ts` writes the JSON file and is imported by **no production module**
  (only `tests/dashboard/review-status.test.ts`). It is test/CLI scratch.
- The 11 "stranded" issues were present and current in `review_status`, blocked by real recorded
  reasons (`blocker_reasons` = `merge_conflict` ×8, `failing_checks` ×1; 2 `review=blocked`; 1 WIP).

The actual bug: the Flywheel orchestrator (and the dashboard) can **misdiagnose pipeline state by
reading a legacy file instead of the SQLite-backed surfaces.** `roles/flywheel.md` / `docs/flywheel-brief.md`
name the right surfaces but never say the JSON file is a trap — so the RUN-34 orchestrator spelunked
it and filed a false "wiped" bug.

**Guiding principle (operator-stated):** agents read pipeline truth through CLI/API/skills, never raw
state files or the DB directly.

---

## Glossary

- **`review_status` table** — authoritative SQLite store of every issue's review/test/merge gate
  state, in `~/.panopticon/panopticon.db`. Accessed via `src/lib/database/review-status-db.ts`.
- **review-status.json** — `~/.panopticon/review-status.json`. **Legacy/test-only scratch.** Never read.
- **The surfaces** — sanctioned read paths: `pan review pending --ready` (CLI, SQLite); `GET
  /api/flywheel/merge-blockers` (`src/dashboard/server/routes/flywheel.ts`, search
  `getMergeBlockersPayload`); dashboard review snapshots.
- **`BlockerReason`** — `src/lib/review-status.ts` (search `type:.*failing_checks`). Union of **six**
  types: `failing_checks`, `merge_conflict`, `unresolved_conversations`, `changes_requested`,
  `draft_pr`, `not_mergeable`.
- **VerbBadge** — `src/dashboard/frontend/src/components/primitives/VerbBadge.tsx`. `VerbBadgeVariant`
  is a **typed union**; `STATIC_VARIANTS` is `satisfies Record<StaticVerbBadgeVariant, VerbBadgeConfig>`,
  so a new label must be added to BOTH the union and `STATIC_VARIANTS` or typecheck fails.

---

## Requirements

- **FR-1** — The Flywheel's live instructions explicitly prohibit reading `review-status.json` for
  pipeline truth and name the sanctioned surfaces.
- **FR-2** — The Command Deck label distinguishes blocker *kind* (not all → `CHANGES REQUESTED`):
  `merge_conflict`/`not_mergeable`/`draft_pr` → `MERGE BLOCKED`; `failing_checks` → `CI BLOCKED`;
  `changes_requested`/`unresolved_conversations`/review-failed → `CHANGES REQUESTED`.
- **FR-3** — Current operational docs no longer present `review-status.json` as the central/canonical
  store.
- **FR-4** (optional/stretch) — `pan review pending --blocked` CLI surface.
- **NFR-1** — No change to the SQLite store, schema, or any write path.
- **NFR-2** — Frontend changes keep `npm run typecheck` green (the typed VerbBadge contract).

---

## Work items

### WI-1 — Truth-source prohibition in the Flywheel's live instructions (FR-1)

**Files:** `roles/flywheel.md`, `docs/flywheel-brief.md`.

In `roles/flywheel.md`, immediately above the merge-blockers bullet (search `GET
/api/flywheel/merge-blockers`), insert:

```markdown
   - **Pipeline truth lives in SQLite, surfaced via CLI/API — never read state files or the DB directly.**
     Authoritative review/test/merge state is the `review_status` table in `~/.panopticon/panopticon.db`,
     reached ONLY through `pan review pending --ready`, `GET /api/flywheel/merge-blockers`, and the
     dashboard review snapshots. **`~/.panopticon/review-status.json` is legacy/test-only scratch — NOT
     the store, usually empty or stale, and must NEVER be read to judge pipeline state.** An empty or odd
     JSON file means nothing; query the surfaces. (RUN-34 misfiled a "review-status wiped" bug from
     spelunking this file while all 11 issues were healthy in SQLite, blocked only by merge_conflict/failing_checks.)
```

In `docs/flywheel-brief.md`, add the same rule (condensed to 3 sentences) as the first paragraph under
`## Status vs State` (search `## Status vs State`).

**Verify:** `grep -n "review-status.json" roles/flywheel.md docs/flywheel-brief.md` shows the
prohibition in both.

### WI-2 — Command Deck distinguishes blocker kind, via the typed badge contract (FR-2, NFR-2)

This is **not** only a `ProjectOverview.tsx` helper — it extends the badge primitive's typed variant
contract. Three files.

**(a) `src/dashboard/frontend/src/components/primitives/VerbBadge.tsx`** — add two variants.
- Extend `VerbBadgeVariant` (search `export type VerbBadgeVariant`) with `'MERGE BLOCKED'` and
  `'CI BLOCKED'`.
- Add entries to `STATIC_VARIANTS` (search `const STATIC_VARIANTS`). **Styling decision (made here,
  not left to taste):** `MERGE BLOCKED` uses the **destructive/red** token (structural — a conflict
  won't clear itself); `CI BLOCKED` uses the **warning/amber** token (CI failures are often
  re-runnable/fixable). Reuse the exact tokens neighboring variants use (match how `'CHANGES
  REQUESTED'` at search `'CHANGES REQUESTED':` and any existing destructive variant are styled — do
  not invent new colors; honor the dashboard style guide's color-restraint rules).

**(b) `src/dashboard/frontend/src/components/primitives/VerbBadge.test.tsx`** — add `MERGE BLOCKED`
and `CI BLOCKED` to the static-variant coverage and update the inline snapshot.

**(c) `src/dashboard/frontend/src/components/CommandDeck/ProjectOverview.tsx`** — classify by blocker
kind with a **typed** helper. Current (search `'CHANGES REQUESTED'`, ~`:418`):

```tsx
  if (isBlockedFeature(entry.feature, entry.reviewStatus)) return { variant: 'CHANGES REQUESTED' };
```

Add near the other classifier helpers (after `isBlockedFeature`):

```tsx
function blockedVariant(
  reviewStatus?: ReviewStatusSnapshot,
): Extract<VerbBadgeVariant, 'CHANGES REQUESTED' | 'MERGE BLOCKED' | 'CI BLOCKED'> {
  const types = new Set((reviewStatus?.blockerReasons ?? []).map(b => b.type));
  // Structural merge blockers first (cannot merge regardless of review verdict).
  if (types.has('merge_conflict') || types.has('not_mergeable') || types.has('draft_pr')) return 'MERGE BLOCKED';
  if (types.has('failing_checks')) return 'CI BLOCKED';
  // Review-feedback blockers and review/test-failed statuses.
  if (types.has('changes_requested') || types.has('unresolved_conversations')) return 'CHANGES REQUESTED';
  if (MERGE_BLOCKED_STATUSES.has(reviewStatus?.mergeStatus ?? '')) return 'MERGE BLOCKED';
  if (TEST_BLOCKED_STATUSES.has(reviewStatus?.testStatus ?? '')) return 'CI BLOCKED';
  return 'CHANGES REQUESTED'; // review failed/blocked or stuck with no merge-level reason
}
```

After (search `'CHANGES REQUESTED'`, ~`:418`):

```tsx
  if (isBlockedFeature(entry.feature, entry.reviewStatus)) return { variant: blockedVariant(entry.reviewStatus) };
```

**Precedence decision (made here):** structural merge blockers (`merge_conflict`/`not_mergeable`/`draft_pr`)
take precedence over `failing_checks`, which takes precedence over review-feedback. So a PR that is
both conflicted and CI-red shows `MERGE BLOCKED`.

**(d) Tests — `src/dashboard/frontend/src/components/CommandDeck/__tests__/ProjectOverview.test.tsx`**
(create if absent; search the dir). Cover: `merge_conflict` → `MERGE BLOCKED`; `not_mergeable` →
`MERGE BLOCKED`; `failing_checks` → `CI BLOCKED`; review `failed`/`blocked` with no blockerReasons →
`CHANGES REQUESTED`; `changes_requested` → `CHANGES REQUESTED`; precedence (conflict + failing_checks)
→ `MERGE BLOCKED`.

### WI-3 — Remove the "central review-status.json" model from current operational docs (FR-3)

Update these (verified to contain the misleading model):
- `docs/MISSION-CONTROL.md` (search `central \`review-status.json\``, ~`:26`) — change to "review/test
  status from SQLite (`review_status` in `panopticon.db`)".
- `docs/KANBAN-MODEL.md` (search `review-status.json`, ~`:114`, ~`:247`) — replace with the SQLite
  store; `readyForMerge` is a column on `review_status`.
- `docs/FLYWHEEL-STATE.md` — if it asserts JSON-as-store, correct it; otherwise leave (it is a
  historical run log).

Out of scope (do NOT sweep): completed PRDs under `.pan/specs/` and other historical artifacts.

**Verify:** `rg -n "central .*review-status.json|review-status.json.*(canonical|source of truth)" docs roles sync-sources`
returns no current operational hits (historical artifacts excluded).

### WI-4 (optional/stretch) — `pan review pending --blocked` CLI surface (FR-4)

**Files:** `src/cli/commands/pending.ts`, `src/cli/index.ts`, `sync-sources/skills/pan-review/SKILL.md`.
- `pending.ts` already reads SQLite (`getAllReviewStatusesFromDb`) and has a `--ready` branch (search
  `options.ready`). Add a `--blocked` branch listing issues with `blockerReasons.length>0` OR
  `reviewStatus`∈{failed,blocked} OR `testStatus`∈{failed,dispatch_failed} OR `stuck`, printing the
  blocker kind.
- `src/cli/index.ts` — register `.option('--blocked', …)` under the `review pending` command (search
  `.command('pending')`, ~`:326`).
- **Repo rule (skills-convention):** update `sync-sources/skills/pan-review/SKILL.md` in the **same
  commit** (NOT `skills/pan-review/…` — the source of truth is under `sync-sources/`); `scripts/lint-skills.sh`
  cross-checks every flag.
- CLI tests cover `--ready`, `--blocked`, and the no-flag default still listing pending reviews.

Optional because `merge-blockers` already gives agents a sanctioned surface.

---

## Restated repo rules the executor must honor

- **Dashboard server is Node-22-only**; after frontend changes run the Vite/`npm run build` before
  restart. Keep `npm run typecheck` green — the VerbBadge contract is typed.
- **Dashboard style guide:** no decorative color; reuse existing destructive/warning tokens; do not
  introduce new palette entries for the two badges.
- **Skills-convention:** WI-4 updates the wrapper skill in the same commit (lint enforces it).

---

## Acceptance criteria (1:1 with work items)

- **AC-1 (WI-1)** — `grep -n "review-status.json" roles/flywheel.md docs/flywheel-brief.md` shows the
  prohibition in both, naming the three surfaces.
- **AC-2 (WI-2)** — `npm run typecheck` passes with the two new variants; `VerbBadge.test.tsx` covers
  `MERGE BLOCKED` + `CI BLOCKED`; `ProjectOverview` tests prove all five+precedence classifications;
  a `merge_conflict`-only issue renders `MERGE BLOCKED`, `failing_checks` renders `CI BLOCKED`, a
  review-failed issue renders `CHANGES REQUESTED`.
- **AC-3 (WI-3)** — the `rg` check in WI-3 returns no current operational hits.
- **AC-4 (WI-4, if done)** — `pan review pending --blocked` lists blocked issues with blocker kind
  from SQLite; `scripts/lint-skills.sh` passes with the updated `sync-sources/skills/pan-review` skill.
- **AC-5 (NFR-1)** — `git diff` touches no `src/lib/database/` or `review-status*` write path; the
  `review_status` schema is unchanged.

---

## Related issues — addresses vs. relates (softened per review)

- **Directly resolves** the "Flywheel shows BLOCKED but the Command Deck tree does not match"
  confusion (WI-2) and prevents the misdiagnosis class (WI-1).
- **Related but NOT resolved:** [#1560](https://github.com/eltmon/panopticon-cli/issues/1560) is about *re-posting commit status on PR head
  drift*; [#1213](https://github.com/eltmon/panopticon-cli/issues/1213) is about *deacon reset/re-dispatch after rebase*. This issue does
  not change either mechanism — it only ensures the *correct* status is read/labelled. Leave their
  mechanics to those issues.
- **Sibling fixes** executed together: [#1877](https://github.com/eltmon/panopticon-cli/issues/1877), [#1884](https://github.com/eltmon/panopticon-cli/issues/1884).
