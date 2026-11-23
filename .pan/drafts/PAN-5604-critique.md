plan-digest: 95ed121936fca7cb23796282a95dca37934c08d6ac029d53a0d799096c792dc9

## blocks-the-design: Latch opens before replay clears questions

Evidence: `src/dashboard/frontend/src/components/EventRouter.tsx:238-250` syncs the snapshot and calls `setStreamLive(true)` before `completeSnapshotRecovery` decides whether replay is needed and before `replay()` applies later events. `src/dashboard/frontend/src/lib/recoveryCoordinator.ts:110-121` returns `needsReplay = true` when events arrive during snapshot recovery; the existing test at `src/dashboard/frontend/src/lib/__tests__/recoveryCoordinator.test.ts:133-146` confirms this case. If the snapshot still contains an AUQ and a deferred `agent.enrichment_changed` clears it, the proposed latch exposes the stale AUQ while replay is pending, so the toast and dialog can appear briefly. The one-way latch also leaves this window open on subsequent reconnects.

Smallest change: expose newly synced agent pending input only after snapshot recovery and required replay have finished, on both first bootstrap and reconnect. Preserve already announced keys during recovery so a reconnect does not dismiss or reannounce them. Add a test with a snapshot containing a question and a replayed clearing event; assert that no toast or dialog appears.
