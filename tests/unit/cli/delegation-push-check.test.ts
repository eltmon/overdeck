/** PAN-4651 WI-13 (D-4651-7): unpushed commits before delegating to another machine. */
import { describe, expect, it, vi } from 'vitest';

import { checkUnpushedCommits, type GitRunner } from '../../../src/cli/commands/delegation-push-check.js';

function git(answers: { count?: string | Error; branch?: string; push?: Error | null }) {
  return vi.fn<GitRunner>(async (args) => {
    if (args[0] === 'rev-list') {
      if (answers.count instanceof Error) throw answers.count;
      return { stdout: `${answers.count ?? '0'}\n` };
    }
    if (args[0] === 'rev-parse') return { stdout: `${answers.branch ?? 'feature/pan-9'}\n` };
    if (args[0] === 'push') {
      if (answers.push) throw answers.push;
      return { stdout: '' };
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  });
}

describe('checkUnpushedCommits (D-4651-7)', () => {
  it('ac13: 2 unpushed commits refuse with the re-run choices', async () => {
    const result = await checkUnpushedCommits('/ws', { label: 'desk' }, git({ count: '2' }));
    expect(result).toEqual({
      ok: false,
      message: '2 commits on feature/pan-9 are not pushed; desk starts from origin. Re-run with --push-first to push them, or --ignore-unpushed.',
    });
  });

  it('--push-first pushes, then proceeds; a failed push refuses', async () => {
    const runner = git({ count: '2' });
    expect(await checkUnpushedCommits('/ws', { label: 'desk', pushFirst: true }, runner)).toEqual({ ok: true, note: 'Pushed 2 commits on feature/pan-9.' });
    expect(runner).toHaveBeenCalledWith(['push'], '/ws', 120_000);
    const failing = await checkUnpushedCommits('/ws', { label: 'desk', pushFirst: true }, git({ count: '1', push: new Error('rejected\nhint') }));
    expect(failing).toEqual({ ok: false, message: 'git push failed, so nothing was started on desk: rejected' });
  });

  it('--ignore-unpushed skips the check; no upstream counts as zero with a note; zero passes', async () => {
    const runner = git({ count: '5' });
    expect(await checkUnpushedCommits('/ws', { label: 'desk', ignoreUnpushed: true }, runner)).toEqual({ ok: true, note: null });
    expect(runner).not.toHaveBeenCalled();
    const noUpstream = await checkUnpushedCommits('/ws', { label: 'desk' }, git({ count: new Error('no upstream configured') }));
    expect(noUpstream).toMatchObject({ ok: true });
    expect((noUpstream as { note: string }).note).toContain('no upstream');
    expect(await checkUnpushedCommits('/ws', { label: 'desk' }, git({ count: '0' }))).toEqual({ ok: true, note: null });
  });
});
