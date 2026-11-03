plan-digest: 431af1bc1d3ee13854f6ee13c36970e3123de183a8f399a1c46a801e2534fdb8

## blocks-the-design: Approval can be discarded between polls

The PRD promises that an approval already given is preserved (D6 and FR-4, lines 63 and 77), but WI-3 checks `shouldYield` **before** each gate poll (line 255). The server's `approveRestartGate` immediately puts every pending request into an epoch (`src/dashboard/server/services/restart-gate.ts`, lines 249-271). If the last poll answered `pending`, the operator approves during the sleep, and a marker appears before the next iteration, `inEpoch` is still false and the holder yields without reading that approval. Its request later expires, and the newcomer needs another approval. Add an atomic gate-side withdrawal that succeeds only while the request is pending, and yield only after that succeeds; revise NFR-2's no-server-change constraint and test this interleaving.

## blocks-the-design: An older target can replace a newer build

WI-2 supersedes whenever `holder.targetSha !== targetSha` (PRD lines 208-216); WI-5 resolves the newcomer's SHA before lock acquisition (lines 305-337). An invocation can resolve commit A, pause, then resume after another invocation has resolved and acquired the lock for descendant B. The A invocation now marks B for supersession and can become the final waiting build. Equality is not an ordering test, so this reverses the issue's “newest build” guarantee. Re-resolve on contention and require the replacement target to contain the holder's commit before writing a marker; cover an older paused invocation and divergent history in tests.

## blocks-the-design: One marker loses concurrent waiters

WI-2 defines one `reload-supersede.json` path and atomic replacement writes (PRD lines 166-176), while its loop writes a marker only once per holder PID (lines 213-216). With two newcomers A and B, B can overwrite A's marker and then die. The holder ignores dead B (line 206); A remains alive but never rewrites its request, so it times out after 20 minutes instead of replacing the holder. A read-then-unlink in `clearReloadSupersedeRequest` can also delete a marker another writer installed between those operations. Use a separate pid-scoped marker per newcomer, remove only that writer's marker, and let the holder inspect live requests; test the two-waiter death and cleanup races.

## blocks-the-design: Target fetch breaks the pan dev shortcut

WI-5 moves `resolveOriginMainSha` before lock acquisition and exits on fetch failure (PRD lines 305-337). The existing `pan dev` branch is **after** the lock and signals SIGUSR2 without fetching or building (`src/cli/commands/reload.ts`, lines 182-225); `reload.test.ts`, lines 267-286, tests that shortcut. With the proposed order, an unavailable origin makes `pan reload` fail before it can signal a running dev server, and an identical-holder result can skip that signal. Preserve the dev branch's current lock-and-signal path before production target resolution, and add a dev-mode test where fetching origin would fail.
