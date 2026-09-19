# Overdeck — Known Concerns / Sharp Edges

- **Dual planning-session naming.** Route/CLI spawns `planning-<issue>`
  (`src/lib/overdeck/planning-sessions.ts:266`); Cloister `spawnRun(id,'plan')`
  spawns `agent-<issue>-plan` (`src/lib/agents/spawn-prep.ts:621-625`). Any
  code that enumerates per-issue sessions must handle BOTH (and classify
  `agent-<issue>-plan` by `state.role === 'plan'`, not name prefix). Several
  read-model builders historically only knew `planning-<issue>` (PAN-2598).

- **Workspace runtime dirname split (`.pan` vs `.overdeck`).**
  `PAN_DIRNAME = '.pan'` (`src/lib/pan-dir/types.ts:10`) but newer flows create
  `<workspace>/.overdeck/`. Existence checks keyed on `.pan` alone miss
  modern workspaces (bit PAN-2598's session-trees pre-filter).

- **Elapsed-time-as-duration.** Both session builders
  (`routes/command-deck.ts`, `routes/projects.ts`) computed `duration` as
  `now - startedAt` with `endedAt` never populated; any consumer treating
  `duration !== null` as "session finished" is wrong (PAN-2598 RC-1).

- **String-marker contracts break silently.** The AUQ deny detector keys on a
  literal (`PAN-1520`) inside the hook's emitted reason; a copy-edit in
  PAN-2530 stripped it and detection silently inverted (pending → answered).
  Contracts between bash hooks and TS detectors need contract tests that run
  the real hook (PAN-2598 RC-4).

- **Write-only AgentState fields.** Fields added to the state.json codec but
  not the agents DB table are invisible to `getAgentStateSync` (PAN-1908).
  Always add DB columns + codec + round-trip test.

- **postMergeLifecycle re-entrancy.** Guarded by `createInFlightGuard`
  (`src/lib/cloister/in-flight-guard.ts`) + locked test; keep it green.

- **Docker network pool exhaustion.** ~31 bridge networks max; merge-time
  Docker cleanup in postMergeLifecycle must never be removed.

- **Circular ESM in dashboard source.** Node rejects them at source level;
  only the tsdown-bundled `dist/dashboard/server.js` runs under Node — no
  tsx/bun for the server.

- **RTK output compression** can garble Bash output agents read; trust exit
  codes, re-run with `OVERDECK_RTK_ENABLED=0` when parsing matters.

- **Review pipeline wedges** historically come from idempotency guards +
  missing deadlines + sandboxed journal writes (see PAN-2583..2587, all fixed
  2026-07-12); symptoms and tactical unblocks are in project memory.

- **Event log is short-retention forensics.** `events` in `overdeck.db` has
  7-day retention with startup compaction (`src/dashboard/server/event-store.ts`
  `compact()`); `review.status_changed` is the only place full verdict-history
  sequences (with the failure reason in `reviewNotes`/`testNotes`) survive —
  the `review_status` row is cleared at close-out and the permanent record
  keeps only the final state. Anything needing verdict history older than a
  week must snapshot first (PAN-3365/PAN-3367: negative verdicts reset to
  `pending` then replaced with `passed` with zero commits between).

- **Command-palette text is ambiguous in tests.** Scope-chip labels
  ("Conversations", "Memory", …) also appear as cmdk group headings, so
  `getByText` matches both. Chips: `getByRole('button', { name })`; group
  headings: find the element with the `cmdk-group-heading` attribute
  (pattern at `CommandPalette.test.tsx:206-214`). Rows are matched by
  `[role="option"][data-value="<stable-id>"]`, never by visible text
  (`Highlighted` splits text across spans).

<!-- last-verified: 2026-08-14 -->
