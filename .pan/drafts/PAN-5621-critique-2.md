plan-digest: e443c307b331eb0e61c5e94d2fb3c6363b85c3ecfdff2a27516a94c19083d85b

## blocks-the-design: Per-file read errors still look like an empty queue

The proposed outer catch only detects failures from directory reads. [quality-gate-admission-files.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5621/src/lib/cloister/quality-gate-admission-files.ts), lines 54–60, makes readJson return null for every error, including EACCES. [quality-gate-admission.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5621/src/lib/cloister/quality-gate-admission.ts), lines 527–539, then skips unreadable owner and waiter files. A readable directory containing unreadable queue files can therefore return an apparently confirmed empty snapshot and trigger the false recovery this revision aims to prevent. Make the snapshot's file reads distinguish a vanished file from an unreadable one, return readError for the latter, and test that path.

## blocks-the-design: An admission during detection can be invisible

WI-4 reads the queue, then reads memory, reserves, the estimate and the runtime census before setting openedAtMs = now() and writing the record ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5621/.pan/drafts/PAN-5621.md), lines 375–400). WI-2 records owner.acquiredAt, set when the owner is created before it settles and returns ([quality-gate-admission.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5621/src/lib/cloister/quality-gate-admission.ts), lines 855–878 and 914–920). A gate can start and finish between the initial snapshot and record write; its marker is then earlier than openedAtMs. With another waiter present, the next poll sees neither an owner nor a qualifying marker and retains a false episode. Anchor the episode's progress boundary to the initial observation time and recheck the queue before announcing; add a test that admits a short gate during the opening poll.

## blocks-the-design: A marker write failure hides a completed gate

WI-2 explicitly swallows a failed last-admitted.json write, including the directory-at-marker-path case in its acceptance test ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5621/.pan/drafts/PAN-5621.md), lines 282–292). The close rule sees progress only through a live owner or that marker (lines 111–116). If the gate finishes between polls and another waiter remains, the record continues to say the queue is starved even though a gate ran; the promised short-gate recovery is therefore conditional on an unacknowledged best-effort write. Add a durable or retryable progress signal that survives a short admission, or explicitly bound and report this failure mode and weaken the recovery requirement and tests.

## blocks-the-design: The phone push omits required memory holders

FR-1 says both the activity entry and phone push name the top memory holders ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5621/.pan/drafts/PAN-5621.md), line 46). The prescribed push body at line 155 contains the head, wait, footprint, reserve and available memory, but no holder names or sizes. Include the captured holders in the push body, with a length rule if needed, and assert it in WI-4.

## sharpens-framing: A blocked head does not prove the queue cannot move

The glossary defines starvation as no gate being able to start ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5621/.pan/drafts/PAN-5621.md), line 14), but D3 checks only whether the head fits alone. Existing admission explicitly allows a later waiter to pass a memory-blocked head when the head cannot run alone ([quality-gate-admission.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5621/src/lib/cloister/quality-gate-admission.ts), lines 709–749). For example, with a 9 GiB soft reserve, 8 GiB hard reserve and 10 GiB available, a 2.7 GiB head fails the alone rule while a later 0.5 GiB gate can start. Either define the alert as head starvation, or include all waiters' admission eligibility in the queue-starvation predicate and test a smaller passing waiter.
