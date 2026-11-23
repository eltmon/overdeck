plan-digest: 237a868b91b5bc841ef56789808edcb63431a2d2e138cd35939f77d680227e2c

## blocks-the-design: Restore can miss an in-progress reclaim

The PRD's D9 step 2 (`.pan/drafts/PAN-5623.md:131`) returns `none` on an unlocked journal read before taking the stack lock. D5 (`:125`) and WI-12 (`:404-405`) append `stack.reclaimed` only after the reclaim has acquired that lock and rechecked activity. A verification worker can start after that recheck but before the append: its restore sees no entry, returns without waiting, and the reclaim then stops the stack before the worker's container gate. The verification call site is after `verification.started` (`src/lib/cloister/verification-runner.ts:210-215`), and container gates use `docker exec` (`src/lib/cloister/validation.ts:434`). The same gap affects spawn. Remove the unlocked early return: every spawn and verification restore attempt should acquire the stack lock and check the journal inside it, even when the first read is empty. Add a test that pauses reclaim after its lock/recheck, starts verification, then confirms restore waits and starts the stopped container before the gate proceeds.

## blocks-the-design: Top-three search can permanently skip a parked issue

FR-2 makes the parked position a candidate condition (`.pan/drafts/PAN-5623.md:39-47`), but WI-12 ranks issues before checking that condition and evaluates only the first three (`:401-403`). If those three are active or otherwise not parked and the fourth is parked, every 30-second poll returns `none-parked`; the rankings do not change, so the eligible stack is never reclaimed. Check parked status for every ranked candidate until the largest eligible one is found, or use a cursor that guarantees the remaining candidates are examined on later polls. Test four ranked issues where only the fourth is parked.

## blocks-the-design: The lock directory is not guaranteed to exist

WI-12 takes `<workspace>/.overdeck/stack-reclaim.lock` before it appends the first reclaim entry (`.pan/drafts/PAN-5623.md:393-405`). `withFileLock` opens the lock with `open(lockPath, 'wx')` and propagates `ENOENT`; it does not create parent directories (`src/lib/vault/file-lock.ts:38-50,63-70`). The journal writer creates `.overdeck` only when it appends (`src/lib/cloister/pipeline-journal.ts:73-85`). An otherwise eligible merge-ready workspace with no journal directory therefore cannot be reclaimed. After confirming the workspace exists, create its `.overdeck` directory before acquiring the lock, and test an eligible workspace that has no prior journal.

## blocks-the-design: A failed stop consumes the only attempt

D5 says a failed `docker stop` leaves the `stack.reclaimed` entry in place (`.pan/drafts/PAN-5623.md:125`). WI-2's `reclaimedInEpisode` treats any matching entry as already reclaimed (`:217-220`), and FR-2 rule 6 excludes it on every later poll (`:45`). If Docker rejects every stop during a transient failure, no memory is freed and this issue is never retried during the open starvation episode. Record actual stop outcomes and allow a bounded retry for failed container IDs, while retaining the once-per-episode rule for successfully stopped and restored stacks. Test an all-failed stop followed by a successful retry in the same episode.
