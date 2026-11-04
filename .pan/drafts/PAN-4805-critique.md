plan-digest: 07113aa20b2e96807a97de7d22d9b1564741041d294799a6875d7e950f7fb573

## blocks-the-design: health can validate the wrong dashboard

The PRD's WI-2 keeps `waitForHealth` unchanged. It returns on any successful `GET /api/health` (`src/dashboard/frontend/tests/fixtures/isolated-dashboard.ts`, lines 65–83), after probing a port and releasing it before spawning the child (lines 98–118 and proposed WI-1). If another fixture binds that port in the gap, its health response can arrive while this child's `exitCode` is still null. `bootOnce` then returns the other fixture's URL and home association instead of reaching the proposed EADDRINUSE retry. The health response already carries the serving process's PID (`src/dashboard/server/identity.ts`, lines 13–25; `src/dashboard/server/health-response.ts`, lines 81–91). Make `waitForHealth` accept the spawned child's PID and return only when the response PID matches it; keep polling on a mismatch so this child's bind failure reaches the retry. Add a deterministic test with a different process serving a healthy response on the selected port.

## blocks-the-design: transient bind warnings trigger unrelated retries

The proposed `isAddressInUseOutput` checks only `output.includes('EADDRINUSE')`, and WI-2 retries on any `FixtureBootError` carrying that text. `retryDashboardBind` logs an EADDRINUSE warning for each retryable bind failure (`src/dashboard/server/server-bind.ts`, lines 13–28; `src/dashboard/server/server.ts`, lines 196–201). The child can later bind successfully, then fail health for another reason; its captured output still contains the warning, so the fixture retries and violates FR-5's no-retry rule for other failures. Limit retry eligibility to an early child exit caused by the final bind error, not a prior warning; for example, require a closed child and match the fatal `listen EADDRINUSE` error line. Test a warning followed by an unrelated failure.

## sharpens-framing: second port is not guaranteed fresh

WI-2 says the retry uses a fresh port, but it calls `pickPort()` without excluding the first port. WI-1 releases each probe socket before returning, so the OS can assign the same port again. The five-probe limit only rejects 3011. Keep the first attempted port out of the retry's candidate set, and add a test where the probe returns the same port before a different one.
