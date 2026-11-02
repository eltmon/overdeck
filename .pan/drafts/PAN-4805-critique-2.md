plan-digest: d373af7ef04d73198aa570436ab45d16c82cf3387d0b6484636cd26d85f2be93

## blocks-the-design: missing PID can pass health

The PRD says a missing health `pid` must count as not ready ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4805/.pan/drafts/PAN-4805.md), line 54), but its exact `waitForHealth` code makes `child.pid` optional and returns when `body.pid === child.pid` (lines 123–145). If both fields are absent, `undefined === undefined` is true, so a 200 response without a PID can mark a child with no PID healthy. Require `typeof child.pid === 'number'` and `typeof body.pid === 'number'` before comparing, and add a missing-PID test.

## blocks-the-design: port-probe failure leaks the temp home

`pickPort` can reject after five skipped probes or a socket error ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4805/.pan/drafts/PAN-4805.md), lines 77–107). The proposed `startIsolatedDashboard` creates `home` and awaits the first `pickPort()` before entering its cleanup `try` (lines 195–215). If that await rejects, the new temp home is left behind, contrary to FR-5's cleanup rule (line 42). Move first-port acquisition inside the outer `try` so its `catch` removes the home.

## sharpens-framing: retry has no deterministic acceptance test

The eight specified unit tests cover port selection, the output detector, and PID polling ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4805/.pan/drafts/PAN-4805.md), lines 232–241). AC-4 runs normal Playwright specs (line 261), which may never collide, so a broken `bootOnce` retry branch could pass every gate while FR-3 remains unverified. Add one deterministic test that makes the first fixture-selected port busy through spawn and checks one retry on a different port with the same home, then checks that an explicit `port` never retries. The existing `opts.port` restart in [pan-4279-degraded-mode.spec.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4805/src/dashboard/frontend/tests/pan-4279-degraded-mode.spec.ts), line 50, shows why that second assertion matters.
