---
scope: dev
paths:
  - "**/*.test.ts"
  - "**/__tests__/**/*.ts"
  - "tests/**/*.ts"
---
### Fake timers for retry / backoff / delay-based tests

Any test that exercises retry logic, Retry-After headers, exponential backoff, or delay-based code MUST use `vi.useFakeTimers()` + `vi.advanceTimersByTime()` / `vi.runAllTimersAsync()`. Never rely on real `setTimeout` for delays in tests.

**Why:** real 2-second retry delays × multiple attempts × many tests in the same file keep test contexts (and their fetch mocks, abort controllers, intervals) alive in memory long enough to cause OOM when parallelized across workers. The symptom is a suite that "needs" `maxForks: 1` to pass — that is hiding the real bug, not fixing it.

The correct pattern:

```ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('retries after Retry-After delay', async () => {
  const resultPromise = callTheThing();
  await vi.advanceTimersByTimeAsync(2000);
  const result = await resultPromise;
  expect(result).toEqual(/*…*/);
});
```

**Never:**

- Use real `setTimeout`s with `retry-after: '2'` — each attempt burns 2s of wall-clock.
- Drop `maxForks` to 1 to mask an OOM — that serializes the whole suite.
- Raise `--max-old-space-size` to paper over a leak in test scaffolding.

If a test must wait for real wall-clock delay (genuine I/O timing, flake-hunt reproducers), put it in a separate file tagged `@slow` and excluded from the default run.
