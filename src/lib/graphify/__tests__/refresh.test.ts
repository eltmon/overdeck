import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const exec = vi.fn();
  exec[Symbol.for('nodejs.util.promisify.custom')] = (command: string, options: { cwd: string; timeout?: number }) => new Promise((resolve, reject) => {
    exec(command, options, (error: Error & { stdout?: string; stderr?: string } | null, stdout: string, stderr: string) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
  return {
    exec,
    existsSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  exec: mocks.exec,
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
}));

import { refreshGraphify } from '../refresh.js';

type ExecResult =
  | { stdout?: string; stderr?: string }
  | { error: Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string } };

type ExecCall = {
  command: string;
  cwd: string;
  timeout?: number;
};

const projectPath = '/tmp/project';
let execResults: ExecResult[];
let execCalls: ExecCall[];

beforeEach(() => {
  execResults = [];
  execCalls = [];
  mocks.existsSync.mockReset();
  mocks.existsSync.mockReturnValue(true);
  mocks.exec.mockReset();
  mocks.exec.mockImplementation((command: string, options: { cwd: string; timeout?: number }, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    execCalls.push({ command, cwd: options.cwd, timeout: options.timeout });
    const result = execResults.shift();
    if (!result) {
      throw new Error(`Unexpected exec command: ${command}`);
    }
    if ('error' in result) {
      callback(result.error, result.error.stdout ?? '', result.error.stderr ?? '');
      return {};
    }
    callback(null, result.stdout ?? '', result.stderr ?? '');
    return {};
  });
});

describe('refreshGraphify', () => {
  it('returns no-graphify-cli when graphify is not on PATH', async () => {
    execResults.push({ error: execError('not found', { code: 1 }) });

    await expect(refreshGraphify(projectPath, 'PAN-1408')).resolves.toEqual({ skipped: 'no-graphify-cli' });
    expect(execCommands()).toEqual(['which graphify']);
    expect(mocks.existsSync).not.toHaveBeenCalled();
  });

  it('returns no-graphify-out when graphify-out is missing', async () => {
    execResults.push({ stdout: '/usr/local/bin/graphify\n' });
    mocks.existsSync.mockReturnValue(false);

    await expect(refreshGraphify(projectPath, 'PAN-1408')).resolves.toEqual({ skipped: 'no-graphify-out' });
    expect(execCommands()).toEqual(['which graphify']);
    expect(mocks.existsSync).toHaveBeenCalledWith('/tmp/project/graphify-out');
  });

  it('returns no-changes when graphify update leaves no staged changes', async () => {
    execResults.push(
      { stdout: '/usr/local/bin/graphify\n' },
      { stdout: 'updated\n' },
      { stdout: '' },
      { stdout: '' },
    );

    await expect(refreshGraphify(projectPath, 'PAN-1408')).resolves.toEqual({ skipped: 'no-changes' });
    expect(execCommands()).toEqual([
      'which graphify',
      'graphify update .',
      'git add graphify-out/',
      'git diff --cached --quiet -- graphify-out/',
    ]);
  });

  it('leaves pre-staged non-graphify files out of the refresh commit', async () => {
    execResults.push(
      { stdout: '/usr/local/bin/graphify\n' },
      { stdout: 'updated\n' },
      { stdout: '' },
      { stdout: '' },
    );

    await expect(refreshGraphify(projectPath, 'PAN-1408')).resolves.toEqual({ skipped: 'no-changes' });
    expect(execCommands()).toEqual([
      'which graphify',
      'graphify update .',
      'git add graphify-out/',
      'git diff --cached --quiet -- graphify-out/',
    ]);
  });

  it('returns gitignored when graphify-out is ignored by git', async () => {
    execResults.push(
      { stdout: '/usr/local/bin/graphify\n' },
      { stdout: 'updated\n' },
      { error: execError('ignored', { code: 1, stderr: 'The following paths are ignored by one of your .gitignore files:\ngraphify-out\nhint: Use -f if you really want to add them.' }) },
    );

    await expect(refreshGraphify(projectPath, 'PAN-1408')).resolves.toEqual({ skipped: 'gitignored' });
    expect(execCommands()).toEqual([
      'which graphify',
      'graphify update .',
      'git add graphify-out/',
    ]);
  });

  it('commits, pushes, and returns the pushed SHA when graphify-out changes', async () => {
    execResults.push(
      { stdout: '/usr/local/bin/graphify\n' },
      { stdout: 'updated\n' },
      { stdout: '' },
      { error: execError('diff found changes', { code: 1 }) },
      { stdout: '[main abc123] chore(graphify): refresh after PAN-1408\n' },
      { stdout: '' },
      { stdout: 'abc123def456\n' },
    );

    await expect(refreshGraphify(projectPath, 'PAN-1408')).resolves.toEqual({ ok: true, commit: 'abc123def456', pushed: true });
    expect(execCommands()).toEqual([
      'which graphify',
      'graphify update .',
      'git add graphify-out/',
      'git diff --cached --quiet -- graphify-out/',
      "git commit -m 'chore(graphify): refresh after PAN-1408' -- graphify-out/",
      'git push origin main',
      'git rev-parse HEAD',
    ]);
  });

  it('retries a non-fast-forward push with fetch, rebase, and one push', async () => {
    execResults.push(
      { stdout: '/usr/local/bin/graphify\n' },
      { stdout: 'updated\n' },
      { stdout: '' },
      { error: execError('diff found changes', { code: 1 }) },
      { stdout: '[main abc123] chore(graphify): refresh after PAN-1408\n' },
      { error: execError('rejected non-fast-forward', { code: 1, stderr: '! [rejected] main -> main (non-fast-forward)' }) },
      { stdout: '' },
      { stdout: 'Successfully rebased\n' },
      { stdout: '' },
      { stdout: 'rebased123\n' },
    );

    await expect(refreshGraphify(projectPath, 'PAN-1408')).resolves.toEqual({ ok: true, commit: 'rebased123', pushed: true });
    expect(execCommands()).toEqual([
      'which graphify',
      'graphify update .',
      'git add graphify-out/',
      'git diff --cached --quiet -- graphify-out/',
      "git commit -m 'chore(graphify): refresh after PAN-1408' -- graphify-out/",
      'git push origin main',
      'git fetch origin main',
      'git pull --rebase origin main',
      'git push origin main',
      'git rev-parse HEAD',
    ]);
  });

  it('aborts a failed non-fast-forward rebase retry', async () => {
    execResults.push(
      { stdout: '/usr/local/bin/graphify\n' },
      { stdout: 'updated\n' },
      { stdout: '' },
      { error: execError('diff found changes', { code: 1 }) },
      { stdout: '[main abc123] chore(graphify): refresh after PAN-1408\n' },
      { error: execError('rejected non-fast-forward', { code: 1, stderr: '! [rejected] main -> main (non-fast-forward)' }) },
      { stdout: '' },
      { error: execError('conflict', { code: 1, stderr: 'CONFLICT (content): Merge conflict' }) },
      { stdout: '' },
    );

    const result = await refreshGraphify(projectPath, 'PAN-1408');

    expect(result).toMatchObject({ ok: false });
    expect('ok' in result && result.ok === false ? result.error : '').toContain('push failed');
    expect(execCommands()).toEqual([
      'which graphify',
      'graphify update .',
      'git add graphify-out/',
      'git diff --cached --quiet -- graphify-out/',
      "git commit -m 'chore(graphify): refresh after PAN-1408' -- graphify-out/",
      'git push origin main',
      'git fetch origin main',
      'git pull --rebase origin main',
      'git rebase --abort',
    ]);
  });

  it('returns push failed when the retry push also fails', async () => {
    execResults.push(
      { stdout: '/usr/local/bin/graphify\n' },
      { stdout: 'updated\n' },
      { stdout: '' },
      { error: execError('diff found changes', { code: 1 }) },
      { stdout: '[main abc123] chore(graphify): refresh after PAN-1408\n' },
      { error: execError('rejected non-fast-forward', { code: 1, stderr: '! [rejected] main -> main (non-fast-forward)' }) },
      { stdout: '' },
      { stdout: 'Successfully rebased\n' },
      { error: execError('still rejected', { code: 1, stderr: 'remote rejected push' }) },
    );

    const result = await refreshGraphify(projectPath, 'PAN-1408');

    expect(result).toMatchObject({ ok: false });
    expect('ok' in result && result.ok === false ? result.error : '').toContain('push failed');
    expect(execCommands()).toEqual([
      'which graphify',
      'graphify update .',
      'git add graphify-out/',
      'git diff --cached --quiet -- graphify-out/',
      "git commit -m 'chore(graphify): refresh after PAN-1408' -- graphify-out/",
      'git push origin main',
      'git fetch origin main',
      'git pull --rebase origin main',
      'git push origin main',
    ]);
  });

  it('returns a timeout error when graphify update times out', async () => {
    execResults.push(
      { stdout: '/usr/local/bin/graphify\n' },
      { error: execError('Command timed out', { killed: true, signal: 'SIGTERM' }) },
    );

    await expect(refreshGraphify(projectPath, 'PAN-1408')).resolves.toEqual({ ok: false, error: 'graphify update timed out' });
    expect(execCalls[1]).toMatchObject({ command: 'graphify update .', cwd: projectPath, timeout: 60_000 });
  });

  it('returns a failed result when graphify update throws unexpectedly', async () => {
    execResults.push(
      { stdout: '/usr/local/bin/graphify\n' },
      { error: execError('graph build failed', { code: 2, stderr: 'parse error' }) },
    );

    const result = await refreshGraphify(projectPath, 'PAN-1408');

    expect(result).toMatchObject({ ok: false });
    expect('ok' in result && result.ok === false ? result.error : '').toContain('graphify update failed');
    expect(execCommands()).toEqual(['which graphify', 'graphify update .']);
  });
});

function execCommands(): string[] {
  return execCalls.map((call) => call.command);
}

function execError(
  message: string,
  options: { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string } = {},
): Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string } {
  const error = new Error(message) as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string };
  Object.assign(error, options);
  return error;
}
