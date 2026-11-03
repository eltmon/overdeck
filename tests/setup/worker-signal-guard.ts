/**
 * PAN-4925: code under test that signals a fixture PID (one read from a
 * mocked pidfile or state row) reaches the real `process.kill` unless the
 * test spies it. On CI that PID can belong to the Vitest worker running the
 * test itself, which kills the worker ("Worker exited unexpectedly") while
 * every reported test stays green. This guard refuses a non-zero signal to
 * the worker, its parent, PID 0, or PID -1, so a missing spy fails the test
 * instead of silently sending a real SIGTERM.
 *
 * Pure logic, no `vitest` import, no global side effects — so the meta test
 * can exercise every refusal with a fake `kill` and synthetic PIDs.
 */

export type KillFn = (pid: number, signal?: string | number) => boolean;

export interface WorkerSignalGuard {
  kill: KillFn;
  drainRefusals(): string[];
  assertNoPendingRefusals(): void;
}

export function createWorkerSignalGuard(options: {
  kill: KillFn;
  protectedPids: readonly number[];
}): WorkerSignalGuard {
  const refusals: string[] = [];

  const kill: KillFn = (pid, signal) => {
    const isNonZeroSignal = signal !== 0;
    if (isNonZeroSignal && options.protectedPids.includes(pid)) {
      const message = `[test-guard] refused process.kill(${pid}, ${String(signal ?? 'SIGTERM')}): that PID is this Vitest worker, the Vitest main process, or a process group — spy process.kill in the test (PAN-4925)`;
      refusals.push(message);
      console.error(message);
      throw new Error(message);
    }
    return options.kill(pid, signal);
  };

  return {
    kill,
    drainRefusals(): string[] {
      return refusals.splice(0, refusals.length);
    },
    assertNoPendingRefusals(): void {
      const pending = this.drainRefusals();
      if (pending.length > 0) throw new Error(pending.join('\n'));
    },
  };
}

export function installWorkerSignalGuard(
  target: { pid: number; ppid: number; kill: KillFn },
  registerAfterEach: (hook: () => void) => void,
): WorkerSignalGuard {
  const installedKey = Symbol.for('overdeck.test.noWorkerSignals');
  const withGuard = target as unknown as Record<symbol, WorkerSignalGuard>;
  const existing = withGuard[installedKey];
  if (existing) return existing;

  const original = target.kill.bind(target);
  const guard = createWorkerSignalGuard({
    kill: original,
    protectedPids: [target.pid, target.ppid, 0, -1, -target.pid, -target.ppid],
  });
  target.kill = guard.kill;
  withGuard[installedKey] = guard;
  registerAfterEach(() => guard.assertNoPendingRefusals());
  return guard;
}
