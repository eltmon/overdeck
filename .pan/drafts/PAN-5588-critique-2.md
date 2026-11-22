plan-digest: ef4e3e67d6419826d628707ce2938b680de25ab53aa177755466e2e6f5749011

## blocks-the-design: Clear the marker before removing the head ticket

The PRD directs WI-3 to clear the marker **after** `await unlinkIfExists(ownTicketPath)` ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5588/.pan/drafts/PAN-5588.md), lines 217–221). The existing return path removes that ticket while retaining its slot owner until `release()` ([quality-gate-admission.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5588/src/lib/cloister/quality-gate-admission.ts), lines 967–989). With `slots: 2`, the next waiter can become head during that gap, see one held slot, sample high CPU, and write the marker through the planned `markCpuBlocked()` call (existing pressure path, lines 890–900). The previous head then deletes the new marker. That next head falls back to its own CPU clock and waits another full bound, recreating the reported stall. None of WI-3's proposed tests forces this overlap.

Move the best-effort `clearQueueCpuBlock(root)` call immediately **before** unlinking the successful head's ticket, after the settle and memory checks. Until that ticket disappears, the next waiter cannot become head and write a marker. Add a two-slot test that interleaves the head's successful admission with the next waiter's pressured sample and verifies the new episode marker survives.
