plan-digest: 0ef7ae330d66d2821d792575d31c537ee5d50b2cd16a983b7043e20f0e199777

## blocks-the-design: Empty idle windows crash result reporting

The PRD's `decideIdle` contract in [pan-5361.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5361/.pan/drafts/pan-5361.md), line 105, unconditionally reads `idleWindows[0].from` and the last window's `to`. The existing smoke skips `idle_window` when the dashboard never becomes healthy ([bare-host-smoke.sh](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5361/scripts/bare-host-smoke.sh), lines 590-604), and `die_setup` calls `write_result` before any measurement (lines 274-279). Today, the inline result code treats absent trace bounds as `spawns = null` and still writes `result.json` (lines 183-209 and 231-234). The planned unconditional access throws instead, losing the structured failure and its CI artifact. Make `spawns` null when there are no idle windows, keep rendering and JSON writing valid for setup and boot failures, and add one no-window test.

## blocks-the-design: Retaken windows use the wrong tree boundary

WI-2 in [pan-5361.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5361/.pan/drafts/pan-5361.md), line 148, discards a negative PID window and restamps `from` before retaking it. WI-3, lines 178-179, takes a tree snapshot only before the first window and after each kept window, then pairs adjacent snapshots. If a window wraps, its first snapshot predates the discarded 30 seconds, while its count and trace bounds describe only the retake. Tree tasks created during the discarded window can therefore be credited to the retained window and change `attribution.source`. On a retake, take a new tree snapshot immediately before the retained window and replace that window's start snapshot; add a test or explicit acceptance check for this boundary.

## sharpens-framing: Unattributed does not establish another host source

FR-6 in [pan-5361.md](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5361/.pan/drafts/pan-5361.md), line 68, requires `excess source: ... so elsewhere on the host` when the tracer and boundary snapshots account for less than half the excess. Decision 9, line 90, correctly states that snapshots miss short-lived tasks and the tracer sees only Node `child_process` calls. Those blind spots leave the source unknown; they do not establish that it was outside the dashboard tree. Change the required output to `not attributed by the dashboard probes; source unknown` and keep the JSON value `unattributed`.
