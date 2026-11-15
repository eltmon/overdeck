plan-digest: 27f2cc51f638f6ec83890413ae77ffc0ed0492a611d26aa0173a68db5dd2757d

## blocks-the-design: Later polls are not established

FR-3 in `.pan/drafts/PAN-5394.md` says the `toHaveBeenCalledTimes(1)` assertion must observe several polls after the first report. WI-3 keeps `await drive(10)` for that purpose. But `drive` only waits 1 ms of real time per attempt and advances pending fake timers (`tests/unit/lib/cloister/quality-gate-admission.test.ts:68-77`); it does not confirm that the admission loop completed another filesystem-backed poll. Under the same threadpool latency invoked as the cause of this flake, all ten attempts can elapse while the next poll is still in progress. The assertion at lines 553-555 can then pass without testing repeat suppression. Smallest fix: instrument `sampleMemory` in this test, record its call count when `onWaiting` first fires, then drive until at least two more calls have occurred and assert that count before checking `onWaiting` remains at one.

## sharpens-framing: Unchanged drive can make re-read test vacuous

The PRD says every unchanged fixed-count drive is safe because a slow host “cannot make them fail” (`.pan/drafts/PAN-5394.md:228-233`). At `tests/unit/lib/cloister/quality-gate-admission.test.ts:1021-1030`, `drive(10)` can finish before the first `readFootprintEstimate` call; changing `estimate` to 1 GiB then lets the test pass without ever proving a re-read from 9 GiB. This is outside the seven positive assertions targeted here, so the smallest correction is to narrow the PRD’s claim: these drives do not cause the reported zero-call failure, but at least this one can weaken coverage on a slow host.
