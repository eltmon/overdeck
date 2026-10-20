import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn<[string, string[], any?], Promise<{ stdout: string; stderr: string }>>(),
}));

vi.mock('node:child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');
  function exec() {
    throw new Error('exec is not used by ensurePRExists');
  }
  function execFile(file: string, args: string[], optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    mocks.execFile(file, args, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((error: any) => callback(error, error.stdout || '', error.stderr || ''));
  }
  (execFile as any)[kCustom] = mocks.execFile;
  return { exec, execFile };
});

const { ensurePRExists } = await import('../ensure-pr.js');

const PR_URL = 'https://github.com/eltmon/overdeck/pull/4576';

describe('ensurePRExists', () => {
  beforeEach(() => {
    mocks.execFile.mockReset();
  });

  it('reuses the existing PR when the lookup fails and gh pr create reports a duplicate', async () => {
    mocks.execFile.mockImplementation(async (_file, args) => {
      if (args[1] === 'list') throw new Error('gh: transient lookup failure');
      throw new Error(
        `Command failed: gh pr create --head feature/pan-4563 --base main\n`
        + `a pull request for branch "feature/pan-4563" into branch "main" already exists:\n${PR_URL}\n`,
      );
    });

    await expect(ensurePRExists('PAN-4563')).resolves.toEqual({ created: false, prUrl: PR_URL });
  });

  it('still reports other gh pr create failures', async () => {
    mocks.execFile.mockImplementation(async (_file, args) => {
      if (args[1] === 'list') return { stdout: '[]', stderr: '' };
      throw new Error('Command failed: gh pr create\nGraphQL: Head sha can\'t be blank');
    });

    const result = await ensurePRExists('PAN-4563');
    expect(result.prUrl).toBeUndefined();
    expect(result.error).toContain('Head sha');
  });
});
