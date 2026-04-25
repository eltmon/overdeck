/**
 * Tests for runQualityGates SSH support and DEFAULT_GATES (PAN-336)
 *
 * Covers the SSH remote workspace functionality ported from the deleted
 * verification-gate.ts into runQualityGates.
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

import { runQualityGates, DEFAULT_GATES } from '../../src/lib/cloister/validation.js';

const workspacePath = '/tmp/test-workspace';

describe('DEFAULT_GATES', () => {
  it('defines typecheck and lint gates (tests handled by test specialist)', () => {
    expect(Object.keys(DEFAULT_GATES)).toEqual(['typecheck', 'lint']);
  });

  it('uses npm commands matching the verification gate defaults', () => {
    expect(DEFAULT_GATES.typecheck.command).toContain('npm run typecheck');
    expect(DEFAULT_GATES.lint.command).toContain('npm run lint');
  });
});

describe('runQualityGates — SSH remote support', () => {
  beforeEach(() => {
    execMock.mockReset();
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('uses SSH prefix for remote workspaces', async () => {
    await runQualityGates(DEFAULT_GATES, workspacePath, 'pre_push', {
      isRemote: true,
      vmName: 'my-vm',
    });

    const calls = execMock.mock.calls.map(c => c[0] as string);
    expect(calls.every(cmd => cmd.startsWith('fly ssh console -a'))).toBe(true);
  });

  it('does not set cwd for remote workspaces', async () => {
    await runQualityGates(DEFAULT_GATES, workspacePath, 'pre_push', {
      isRemote: true,
      vmName: 'my-vm',
    });

    const calls = execMock.mock.calls;
    expect(calls.every(c => c[1]?.cwd === undefined)).toBe(true);
  });

  it('uses local cwd for non-remote workspaces', async () => {
    await runQualityGates(DEFAULT_GATES, workspacePath);

    const calls = execMock.mock.calls;
    expect(calls.every(c => !(c[0] as string).startsWith('ssh'))).toBe(true);
    expect(calls.every(c => c[1]?.cwd === workspacePath)).toBe(true);
  });

  it('throws when isRemote is true but vmName is missing', async () => {
    await expect(
      runQualityGates(DEFAULT_GATES, workspacePath, 'pre_push', { isRemote: true, vmName: undefined })
    ).rejects.toThrow('Remote workspace requires vmName');
  });

  it('throws when vmName contains invalid characters', async () => {
    await expect(
      runQualityGates(DEFAULT_GATES, workspacePath, 'pre_push', { isRemote: true, vmName: 'vm; rm -rf /' })
    ).rejects.toThrow('Invalid vmName for SSH');
  });

  it('throws when workspacePath contains unsafe characters for SSH', async () => {
    await expect(
      runQualityGates(DEFAULT_GATES, '/path/with spaces/workspace', 'pre_push', {
        isRemote: true,
        vmName: 'my-vm',
      })
    ).rejects.toThrow('Workspace path contains unsafe characters');
  });

  it('throws when gate.path produces an unsafe cwd for SSH', async () => {
    const gatesWithBadPath = {
      lint: { command: 'pnpm lint', path: 'frontend;rm -rf /' },
    };
    await expect(
      runQualityGates(gatesWithBadPath, workspacePath, 'pre_push', {
        isRemote: true,
        vmName: 'my-vm',
      })
    ).rejects.toThrow('unsafe characters for SSH');
  });

  it('throws when gate.command contains double quotes (SSH injection prevention)', async () => {
    const gatesWithQuotes = {
      lint: { command: 'echo "hello"' },
    };
    await expect(
      runQualityGates(gatesWithQuotes, workspacePath, 'pre_push', {
        isRemote: true,
        vmName: 'my-vm',
      })
    ).rejects.toThrow('double quotes which are unsafe in SSH context');
  });

  it('includes gate path subdirectory in SSH command', async () => {
    const gatesWithPath = {
      lint: { command: 'pnpm lint', path: 'frontend' },
    };

    await runQualityGates(gatesWithPath, workspacePath, 'pre_push', {
      isRemote: true,
      vmName: 'my-vm',
    });

    const cmd = execMock.mock.calls[0][0] as string;
    expect(cmd).toContain(`cd ${workspacePath}/frontend &&`);
  });

  it('passes 5-minute timeout to each execAsync call for SSH', async () => {
    await runQualityGates(DEFAULT_GATES, workspacePath, 'pre_push', {
      isRemote: true,
      vmName: 'my-vm',
    });

    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    for (const call of execMock.mock.calls) {
      expect(call[1]).toMatchObject({ timeout: FIVE_MINUTES_MS });
    }
  });
});

describe('runQualityGates — DEFAULT_GATES fallback behavior', () => {
  beforeEach(() => {
    execMock.mockReset();
    execMock.mockResolvedValue({ stdout: 'ok', stderr: '' });
  });

  it('runs all 2 default gates when all pass', async () => {
    const results = await runQualityGates(DEFAULT_GATES, workspacePath);

    expect(execMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.passed)).toBe(true);
    expect(results.map(r => r.name)).toEqual(['typecheck', 'lint']);
  });

  it('stops at first failing gate (bail-on-failure)', async () => {
    const typecheckErr = Object.assign(new Error('Type error'), {
      stdout: 'error TS2345: Type mismatch',
      stderr: '',
    });
    execMock.mockRejectedValueOnce(typecheckErr);

    const results = await runQualityGates(DEFAULT_GATES, workspacePath);

    // Only typecheck ran — lint and test were not called
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('typecheck');
    expect(results[0].passed).toBe(false);
  });
});
