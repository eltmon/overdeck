import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const execMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(command: string, optionsOrCallback: any, maybeCallback?: any) {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    execMock(command, typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined)
      .then(({ stdout = '', stderr = '' }) => callback(null, stdout, stderr))
      .catch((error: any) => callback(error, error.stdout || '', error.stderr || ''));
  }

  (exec as any)[kCustom] = execMock;
  return { ...actual, exec };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

import { rebaseFeatureBranch } from '../../../../src/lib/cloister/merge-rebase.js';

beforeEach(() => {
  vi.clearAllMocks();
  execMock.mockImplementation(async (command: string) => {
    if (command.startsWith('git fetch origin')) return { stdout: '', stderr: '' };
    if (command === 'git rev-list --count HEAD..origin/main') return { stdout: '0\n', stderr: '' };
    if (command === 'git rev-parse HEAD') return { stdout: 'feature-sha\n', stderr: '' };
    if (command === 'git rev-parse origin/feature/pan-2961') return { stdout: 'feature-sha\n', stderr: '' };
    if (command.startsWith('git push')) throw new Error(`unexpected push: ${command}`);
    throw new Error(`unexpected command: ${command}`);
  });
});

describe('rebaseFeatureBranch', () => {
  it('does not push when the branch is up to date and already published', async () => {
    const result = await Effect.runPromise(
      rebaseFeatureBranch('/workspace', 'feature/pan-2961', 'main', 'PAN-2961'),
    );

    expect(result).toEqual({
      success: true,
      skipped: true,
      newHead: 'feature-sha',
    });
    expect(execMock.mock.calls.map(([command]) => command)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^git push/)]),
    );
  });
});
