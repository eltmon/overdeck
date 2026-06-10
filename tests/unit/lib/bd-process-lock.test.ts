import { describe, expect, it } from 'vitest';
import { isTransientBdError } from '../../../src/lib/bd-process-lock.js';

describe('isTransientBdError', () => {
  it('returns true for embedded Dolt database lock stderr', () => {
    expect(isTransientBdError({ stderr: 'database is locked' })).toBe(true);
  });

  it('returns true for execFile message strings that include lock contention', () => {
    const error = new Error(
      'Command failed: bd list --json -l pan-1629 --status all --limit 0\nresource temporarily unavailable',
    );

    expect(isTransientBdError(error)).toBe(true);
  });

  it('returns true for execFile-style lock acquisition stderr', () => {
    expect(
      isTransientBdError({
        stderr: 'could not acquire database lock: lock held by another process',
        code: 1,
      }),
    ).toBe(true);
  });

  it('returns true for transient errno codes from child process failures', () => {
    expect(isTransientBdError({ code: 'EAGAIN' })).toBe(true);
    expect(isTransientBdError({ cause: { code: 'EBUSY' } })).toBe(true);
  });

  it('returns false for successful-but-empty bd list results', () => {
    expect(isTransientBdError({ stdout: '[]', stderr: '', code: 0 })).toBe(false);
    expect(isTransientBdError('[]')).toBe(false);
  });

  it('returns false for genuine fatal errors', () => {
    expect(isTransientBdError({ stderr: 'corrupt database: invalid chunk table', code: 1 })).toBe(false);
    expect(isTransientBdError({ message: 'spawn bd ENOENT', code: 'ENOENT' })).toBe(false);
    expect(isTransientBdError(new Error('planning must create beads'))).toBe(false);
  });
});
