plan-digest: bc4fe53c824a4f55cfdc92a5b46f0b8f29405649f178078d05a3b86984ea0ea2

## blocks-the-design: queued waiters retain the old slot limit

The PRD says lowering `quality_gate_slots` from 2 to 1 must keep the cap at 1 even when `slot-1.json` is held ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4546/.pan/drafts/PAN-4546.md), line 92). Yet D5 and WI-3 resolve `slots` only once per `acquireQualityGateAdmission` call (lines 94 and 203–213), while the acquire loop uses that fixed value after every wait ([quality-gate-admission.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4546/src/lib/cloister/quality-gate-admission.ts), lines 283–344). A waiter started at 2 can remain queued through a config change to 1. If `slot-1.json` is then the sole live owner, that waiter still sees `occupied = 1 < 2` and takes free slot 0, leaving two gates running under the new limit. The proposed “lowered cap” test supplies `slots: 1` from the start, so it cannot catch this.

Resolve the global slot count again when the FIFO head is about to test capacity, or explicitly remove the claim that lowering the config applies to already queued requests. If live downshifts are required, add a test that queues at 2, changes the global config to 1 while slot 1 is held, and verifies slot 0 stays vacant until that owner releases.
