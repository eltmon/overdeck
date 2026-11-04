plan-digest: 5bc5660cbe4322118114109a8e33201b62f7bf05274d409c1cf310aad2d06e88

## blocks-the-design: Guard test can kill the test runner

The PRD requires the meta test to call `process.kill(process.ppid, 'SIGKILL')`, `process.kill(0, 'SIGTERM')`, and `process.kill(-1, 'SIGTERM')` in the real Vitest worker (`.pan/drafts/PAN-4925.md`, lines 162–165). Its only protection is the guard being tested, installed through `vitest.config.ts` line 69. If that setup entry is missing or the wrapper malfunctions, the test kills Vitest's parent or its process group; PID -1 can signal other processes the runner user owns. This reproduces the kind of unsafe behavior the issue fixes. Test the refusal decisions through an injected fake `kill` function and synthetic worker/parent PIDs. In the live worker, limit integration checks to signal 0 and a child process the test spawned.

## sharpens-framing: Swallowed-error test does not verify afterEach

FR-4 says a swallowed refusal must fail the running test (`.pan/drafts/PAN-4925.md`, line 88). WI-2's meta test catches the error and drains the refusal before `afterEach` (`.pan/drafts/PAN-4925.md`, lines 158–159 and 169), so it passes even if the `afterEach` failure hook is missing. Keep the drain test for recording, and add an isolated, safe test that leaves a refusal pending and asserts Vitest reports that test as failed; it can use the injected fake `kill` path above.
