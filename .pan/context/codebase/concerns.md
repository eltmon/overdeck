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

- **AgentState is JSON-only now (PAN-3917).** The SQLite `agents` mirror is
  dropped on primary boot (`dropPipelineStateMirrorTablesSync`,
  `src/lib/overdeck/infra.ts`); `state.json` per agent dir
  (`~/.overdeck/agents/<id>/state.json`) is the sole copy and
  `getAgentStateSync` reads it directly (`src/lib/agents/agent-state-read.ts`).
  A new field needs only the codec + a round-trip test — no DB column.

- **postMergeLifecycle re-entrancy.** Guarded by `_completedPostMerge` +
  `_postMergeInFlight` (`src/lib/cloister/merge-agent.ts`) + locked test;
  keep it green.

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

- **Review verdicts live on the forge now (PAN-3917 FR-7).** There is no
  `review_status` row and no `review.status_changed` event — event-store
  startup purges both types on sight (`src/dashboard/server/event-store.ts`).
  A verdict is a GitHub PR review (`approve` / `request-changes`, posted as
  the GitHub App when installed) or, on GitLab / a single-account install, an
  MR note carrying the `overdeck-verdict` marker `pr-facts` reads back
  (`src/lib/cloister/pr-review-verdict.ts`). The per-issue pipeline journal
  (`src/lib/cloister/pipeline-journal.ts`, `<workspace>/.overdeck/pipeline.jsonl`)
  is an append-only, disposable log of what Overdeck did between actions —
  never authority; where it disagrees with the PR, the PR wins. `events` in
  `overdeck.db` still has 7-day retention with startup compaction
  (`event-store.ts` `compact()`) for other event types.

- **Command-palette text is ambiguous in tests.** Scope-chip labels
  ("Conversations", "Memory", …) also appear as cmdk group headings, so
  `getByText` matches both. Chips: `getByRole('button', { name })`; group
  headings: find the element with the `cmdk-group-heading` attribute
  (pattern at `CommandPalette.test.tsx:206-214`). Rows are matched by
  `[role="option"][data-value="<stable-id>"]`, never by visible text
  (`Highlighted` splits text across spans).

<!-- last-verified: 2026-09-20 -->
