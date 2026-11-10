/**
 * PAN-5108 FR-4/FR-7 end to end: update on refusal through the real
 * runLaunchUpdate and update queue, with only execFile mocked. Kept apart from
 * claude-code.test.ts because mocking node:child_process there would also
 * replace the exec its version tests rely on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: execFileMock,
}));

import { _resetLaunchUpdateStateForTests } from '../../fleet/harness-auto-update.js';
import { _resetUpdateQueueForTests } from '../../fleet/harness-update-runner.js';
import { assertClaudeCodeSupportsModel } from '../requirements.js';

const NPM_PLAN = {
  method: 'npm' as const,
  argv: ['/usr/local/bin/npm', 'install', '-g', '--prefix', '/usr/local', '@anthropic-ai/claude-code@latest'],
  display: '/usr/local/bin/npm install -g --prefix /usr/local @anthropic-ai/claude-code@latest',
  runnable: true,
};
const NPM_INSTALL = { method: 'npm' as const, realPath: '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', npmPrefix: '/usr/local' };

describe('update on refusal end to end (PAN-5108)', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    _resetLaunchUpdateStateForTests();
    _resetUpdateQueueForTests();
  });

  it('two concurrent launches run the update command once and both proceed', async () => {
    let updated = false;
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: null, out: string, err: string) => void) => {
      setImmediate(() => {
        updated = true;
        cb(null, 'changed 1 package', '');
      });
      return { stdin: { end: vi.fn() } };
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = {
      readVersion: async () => (updated ? '2.1.300' : '2.1.280'),
      detectInstall: () => NPM_INSTALL,
      upgradePlan: async () => NPM_PLAN,
      resolveRealPath: async (p: string) => p,
      autoUpdateEnabled: async () => true,
    };

    await expect(
      Promise.all([
        assertClaudeCodeSupportsModel('/usr/local/bin/claude', 'claude-sonnet-5-5', deps),
        assertClaudeCodeSupportsModel('/usr/local/bin/claude', 'claude-sonnet-5-5', deps),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, opts] = execFileMock.mock.calls[0]!;
    expect(file).toBe('/usr/local/bin/npm');
    expect(args).toEqual(NPM_PLAN.argv.slice(1));
    expect((opts as { env: NodeJS.ProcessEnv }).env.PATH?.startsWith('/usr/local/bin:')).toBe(true);
    log.mockRestore();
  });
});
