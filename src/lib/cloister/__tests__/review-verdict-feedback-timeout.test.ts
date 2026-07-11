import { beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-2518: the PR-comment POST must carry a bounded timeout so a STALLED `gh api`
// call (not a rejection) can't hang `pan admin specialists done` forever — which
// left the review agent that shelled out to it waiting indefinitely and stalled the
// issue in-review. Capture the options passed to execFile and assert the timeout.
const execFileCalls: Array<{ file: string; args: readonly string[]; options: Record<string, unknown> }> = [];

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (
      file: string,
      args: readonly string[],
      options: Record<string, unknown>,
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      execFileCalls.push({ file, args, options });
      callback(null, '', '');
    },
  };
});

import { postPrComment } from '../review-verdict-feedback.js';

describe('postPrComment (PAN-2518)', () => {
  beforeEach(() => {
    execFileCalls.length = 0;
  });

  it('posts the comment with a bounded timeout and SIGKILL', async () => {
    const ok = await postPrComment('https://github.com/eltmon/overdeck/pull/2488', 'body');
    expect(ok).toBe(true);
    expect(execFileCalls).toHaveLength(1);
    const { file, options } = execFileCalls[0]!;
    expect(file).toBe('gh');
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.killSignal).toBe('SIGKILL');
  });

  it('is a no-op (no exec) when the PR URL is not parseable', async () => {
    const ok = await postPrComment(undefined, 'body');
    expect(ok).toBe(false);
    expect(execFileCalls).toHaveLength(0);
  });
});
