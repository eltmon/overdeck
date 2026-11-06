plan-digest: 717666eb41b269f102e62f7580e56bc29b10075b978152d9f99c78f9d9edcf0d

## blocks-the-design: A failed refresh clears an active alert

PRD lines 489–502 say `fetchDiskAlert` returns `null` on an HTTP or network error, and `diskAlertDecisions(null)` returns no decision. The proposed `useQuery` therefore replaces a previously fetched warning or critical snapshot with `null` on a failed 10-second refresh; the Needs-you card disappears without disk recovery. The current hook consumes query data directly (`src/dashboard/frontend/src/lib/useDecisions.ts`, lines 347–396), so nothing preserves that alert. Make failed refreshes reject while retaining the last successful snapshot, and test a failure after a low-disk response.

## blocks-the-design: Recovery does not invalidate a running holder scan

PRD lines 426–433 start holder measurement asynchronously, discard results by a *crossing* counter, and clear holders on recovery. Recovery is not a crossing under the PRD's glossary and `isDiskAlertCrossing` rule (lines 31–35 and 305–307). If space recovers before `du` finishes, the still-current scan can write its old holders back into an `ok` snapshot after the clear. Advance the measurement generation on every recovery and stop, or check the level before publishing results. Add a deferred-collector test that resolves after recovery.

## blocks-the-design: Two crossings can exceed the four-process disk limit

PRD lines 130–135 promise at most four `du` processes at a time. WI-3 limits each `collectDiskHolders` call to four (lines 355–372), while WI-4 starts a new collection on every upward crossing without waiting for the previous one (lines 424–431). A warning-to-critical crossing during a 120-second warning scan can run eight `du` processes on the pressured disk. Use one service-wide limiter or cancel and drain the prior scan before starting another. `createPromiseConcurrencyLimiter` already provides a shared limiter (`src/lib/concurrency.ts`, lines 91–107). Test overlapping crossings with unresolved measurements.

## blocks-the-design: The scheduled poll uses synchronous filesystem reads

PRD line 125 and WI-4 line 412 require `loadConfigSync().config.resources` on every poll, but NFR-1 (lines 194–197) forbids blocking calls in the service or its callees. Even on a cache hit, `loadConfigSync` calls `getConfigMtimes`, which runs `existsSync` and `statSync` (`src/lib/config-yaml/load.ts`, lines 259–281 and 359–366); a cache miss also runs `readFileSync` (lines 38–45). The same module says those reads can stall dashboard HTTP and terminal traffic (lines 440–449). Read thresholds with the existing async `loadConfigNoMigration` (lines 313–337), and update the dependency type and tests for an asynchronous read.

## sharpens-framing: The critical card inherits an inaccurate group hint

PRD lines 495–502 mark the disk decision `blocking: true`, placing it in `DecisionsPanel`'s “Blocking work” group. That group's fixed hint says “An agent has stopped until you answer” (`src/dashboard/frontend/src/components/DecisionsPanel.tsx`, lines 158–177), while the proposed disk card has no answer action. Specify a truthful hint or separate urgent group for system alerts so the critical state remains prominent without claiming an agent is waiting.
