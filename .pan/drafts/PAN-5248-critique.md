plan-digest: a8099d89f0c3b114e96ddd9d27bc83af5e369984f0393c3c9047e702ca6030c7

## blocks-the-design: memory timeout starts unsafe typechecks

The PRD's FR-9 (line 47) and WI-4 (lines 187-204) say a typecheck that waits 30 minutes runs without admission. The existing queue throws on `maxWaitMs` at `src/lib/cloister/quality-gate-admission.ts`, lines 377-381. If MemAvailable remains below the soft reserve, the wrapper will start the exact heavy typecheck the memory rule held back, with no slot or reservation. Keep an admission failure visible, but do not start `tsc` when the failure is a memory-wait timeout; return a distinct failure status and test that no child was spawned.

## blocks-the-design: memory is stale after settling

The PRD's D10 (line 69) expressly checks memory only before publishing the owner. The queue then waits 1.5 seconds and rechecks only CPU (`src/lib/cloister/quality-gate-admission.ts`, lines 438-460). Another process can consume the available headroom during that wait, and the queue still hands back a lease and starts the gate below the reserve. Recheck memory after settling, excluding the new owner from the other-owner reservation sum, and release the owner and retry when the check fails. Add a test that lowers MemAvailable during settle.

## blocks-the-design: owner RSS does not match the measured gate

The PRD's D4 (line 63) subtracts `currentTreeRss(owner.pid)` from a footprint learned from the gate process. The owner PID is the acquiring process (`src/lib/cloister/quality-gate-admission.ts`, lines 360-373), while verification gates sample the spawned command at `src/lib/cloister/validation.ts`, lines 494-505, and WI-11. The owner tree includes the verification worker and possibly other descendants before this gate allocates; its existing RSS reduces the reservation for a gate that has allocated nothing. The wrapper has the same parent-versus-child mismatch. Track the gate's current RSS on the same root used for its peak, or persist and subtract the owner's pre-gate baseline before reducing its reservation. Test a nonzero owner baseline with an unallocated child.

## blocks-the-design: container gates bypass low-memory protection

The PRD's FR-5 (line 43) and WI-11 (line 271) omit a footprint key for container gates, so WI-3 skips the memory rule entirely for them. `src/lib/cloister/validation.ts`, lines 378-426 and 459-470, still admits a `docker exec` gate; container memory consumes host MemAvailable even though its process is outside the `docker exec` host process tree. Such a gate can start when the host is already below the soft reserve, defeating FR-2 for verification gates. Apply the pre-start MemAvailable rule to container gates too. A conservative full reservation until release is sufficient if container RSS is unavailable; container-specific measurement can remain in the sibling issue.

## sharpens-framing: test the host gate recording path

WI-11's listed acceptance cases check the raw footprint key, a wait log, and that mocks exist; none asserts that a completed host gate calls `recordPeak` or that a signal or timeout skips it. The only current execution path is `src/lib/cloister/validation.ts`, lines 494-523, so a missed sampler or release ordering error could pass every named WI-11 test. Add one successful host-gate peak assertion and one killed-gate no-record assertion to WI-11.
