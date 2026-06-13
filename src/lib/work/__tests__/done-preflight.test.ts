import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { runPreflightChecks } from '../done-preflight.js';
import { runTestRequirementCheck } from '../test-requirement-gate.js';

vi.mock('../test-requirement-gate.js', () => ({
  runTestRequirementCheck: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn((_file: string, _args: string[], _options: unknown, callback: unknown) => {
    const cb = callback as (err: Error | null, stdout: { stdout: string }, stderr: string) => void;
    cb(null, { stdout: '[]' }, '');
    return undefined as unknown as ReturnType<typeof execFile>;
  }),
}));

describe('runPreflightChecks', () => {
  it('forwards testWaived to runTestRequirementCheck (AC1)', async () => {
    vi.mocked(runTestRequirementCheck).mockReturnValue(
      Effect.succeed([]),
    );

    await Effect.runPromise(runPreflightChecks('/workspace', 'PAN-1501', 'waived reason'));
    expect(runTestRequirementCheck).toHaveBeenCalledWith('/workspace', 'PAN-1501', 'waived reason');
  });

  it('appends test-requirement failure lines after the AC-status check (AC2)', async () => {
    vi.mocked(runTestRequirementCheck).mockReturnValue(
      Effect.succeed(['  Test gate failure']),
    );

    const failures = await Effect.runPromise(runPreflightChecks('/workspace', 'PAN-1501'));
    expect(failures).toContain('  Test gate failure');
  });
});
