plan-digest: 6179971c49be03e8fa4bb0fdde8f9707a4288ac82a3bf8a3fb2edc213dbcc0c2

## blocks-the-design: Port check misses listeners that pan up can kill

D8 and FR-5 in the PRD use `curl http://127.0.0.1:<port>/` to decide whether ports 3010 and 3011 are free. An IPv6-only listener on `::1`, or a listener bound only to another interface, refuses that IPv4 connection. Yet `pan up` calls `stopDashboard` ([src/cli/index.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5176/src/cli/index.ts), lines 842–850), whose `pidsOnPort` probes all TCP listeners with `lsof -iTCP:<port> -sTCP:LISTEN` ([src/lib/platform-lifecycle.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5176/src/lib/platform-lifecycle.ts), lines 189–205) and then SIGTERMs their owners (lines 381–413). The smoke can therefore pass its safety check and kill an unrelated developer process. Make the preflight detect listeners on every address, matching `pidsOnPort`'s scope, and fail closed if it cannot determine whether a port is free. Include an IPv6-only listener in the safety acceptance check.

## blocks-the-design: Spawn-budget helper hides failed ticks

WI-1 explicitly tells `spawnsPerTick` to await `tick()` while “swallowing rejections” (PRD line 254). WI-2 then asserts only the resulting counts. A regression that makes a missing-tool poller reject before it reaches `child_process` reports zero spawns and passes all three ticks; each positive control uses the opposite, tool-present branch (PRD lines 273–289). The test would report a healthy budget despite a broken poller. Let `spawnsPerTick` propagate unexpected errors. For a caller whose failure is intentionally part of the contract, convert that result explicitly in that caller's test and assert the expected outcome alongside the count.

## sharpens-framing: Every main push is not covered

Goal 2 and D11 say the macOS smoke runs on every push to `main` (PRD lines 39 and 89), but the existing CI trigger ignores pushes containing only `.pan/**` or `.overdeck/memory/**` ([ci.yml](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5176/.github/workflows/ci.yml), lines 3–11). A job-level `if: github.event_name == 'push'` cannot run when the workflow itself did not start. State the actual promise as “every CI-triggering push to main,” or change the trigger if literally every push is required.

## footnote: Local smoke command omits the tarball directory

WI-5's required header example passes `$(npm pack --ignore-scripts --pack-destination .tmp/smoke | tail -1)` directly to `--tarball` (PRD line 370), while the same line correctly says `npm pack` prints only the filename. From the repository root that path does not name the archive in `.tmp/smoke`. Prefix the substitution with `.tmp/smoke/` in the example and the documentation that repeats it.
