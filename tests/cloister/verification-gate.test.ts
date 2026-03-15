/**
 * Tests for runVerificationGate (PAN-174)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist the exec mock so it is available inside vi.mock factory
const execMock = vi.hoisted(() =>
  vi.fn<[string, any?], Promise<{ stdout: string; stderr: string }>>()
    .mockResolvedValue({ stdout: '', stderr: '' })
);

vi.mock('child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    execMock(cmd, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((err: any) => callback(err, err.stdout || '', err.stderr || ''));
  }

  (exec as any)[kCustom] = execMock;

  return { exec };
});

import { runVerificationGate } from '../../src/lib/cloister/verification-gate.js';

describe('runVerificationGate', () => {
  const workspacePath = '/tmp/test-workspace';

  beforeEach(() => {
    execMock.mockReset();
  });

  it('returns passed when all checks succeed', async () => {
    execMock.mockResolvedValue({ stdout: 'ok', stderr: '' });

    const result = await runVerificationGate(workspacePath);

    expect(result.passed).toBe(true);
    expect(result.failedCheck).toBeUndefined();
    expect(result.checks).toHaveLength(3);
    expect(result.checks.every(c => c.passed)).toBe(true);
    expect(result.summary).toContain('All checks passed');
    expect(result.summary).toContain('typecheck');
    expect(result.summary).toContain('lint');
    expect(result.summary).toContain('test');
  });

  it('bails on typecheck failure without running lint or test', async () => {
    const typecheckErr = Object.assign(new Error('Type error'), {
      stdout: 'error TS2345: Type mismatch',
      stderr: '',
    });
    execMock.mockRejectedValueOnce(typecheckErr);

    const result = await runVerificationGate(workspacePath);

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('typecheck');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].name).toBe('typecheck');
    expect(result.checks[0].passed).toBe(false);
    expect(result.checks[0].output).toContain('Type error');
    expect(result.summary).toContain('Verification FAILED at typecheck');
    // Lint and test should not have been called
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('bails on lint failure without running test', async () => {
    // typecheck passes
    execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // lint fails
    const lintErr = Object.assign(new Error('Lint failed'), {
      stdout: '5 errors found',
      stderr: '',
    });
    execMock.mockRejectedValueOnce(lintErr);

    const result = await runVerificationGate(workspacePath);

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('lint');
    expect(result.checks).toHaveLength(2);
    expect(result.checks[0].passed).toBe(true);
    expect(result.checks[1].passed).toBe(false);
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('reports test failure after typecheck and lint pass', async () => {
    // typecheck + lint pass
    execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    execMock.mockResolvedValueOnce({ stdout: '', stderr: '' });
    // test fails
    const testErr = Object.assign(new Error('Test suite failed'), {
      stdout: '3 tests failed',
      stderr: 'FAIL src/foo.test.ts',
    });
    execMock.mockRejectedValueOnce(testErr);

    const result = await runVerificationGate(workspacePath);

    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe('test');
    expect(result.checks).toHaveLength(3);
    expect(result.checks[2].passed).toBe(false);
    expect(result.checks[2].output).toContain('3 tests failed');
  });

  it('uses SSH prefix for remote workspaces', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });

    await runVerificationGate(workspacePath, { isRemote: true, vmName: 'my-vm' });

    const calls = execMock.mock.calls.map(c => c[0] as string);
    expect(calls.every(cmd => cmd.startsWith('ssh -A my-vm.exe.xyz "cd /tmp/test-workspace &&'))).toBe(true);
  });

  it('uses local cwd for non-remote workspaces', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });

    await runVerificationGate(workspacePath);

    const calls = execMock.mock.calls;
    // No SSH prefix
    expect(calls.every(c => !(c[0] as string).startsWith('ssh'))).toBe(true);
    // cwd set to workspacePath
    expect(calls.every(c => c[1]?.cwd === workspacePath)).toBe(true);
  });

  it('truncates long output to avoid oversized feedback', async () => {
    const longOutput = 'x'.repeat(5000);
    const err = Object.assign(new Error('typecheck failed'), {
      stdout: longOutput,
      stderr: '',
    });
    execMock.mockRejectedValueOnce(err);

    const result = await runVerificationGate(workspacePath);

    expect(result.passed).toBe(false);
    expect(result.summary.length).toBeLessThan(4500);
    expect(result.summary).toContain('...(truncated)');
  });

  it('includes duration in summary for passed checks', async () => {
    execMock.mockResolvedValue({ stdout: 'success', stderr: '' });

    const result = await runVerificationGate(workspacePath);

    expect(result.passed).toBe(true);
    // Each check reports durationMs in the summary
    expect(result.summary).toMatch(/typecheck \(\d+ms\)/);
    expect(result.summary).toMatch(/lint \(\d+ms\)/);
    expect(result.summary).toMatch(/test \(\d+ms\)/);
  });
});
