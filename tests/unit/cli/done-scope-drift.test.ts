/**
 * PAN-3847 W17 — pan done's scope-drift diff fetches origin/<target> first and
 * diffs against origin/<target> from the project config, never a hardcoded or
 * remembered local main.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  readWorkspacePlanSync: vi.fn(),
  changedFilesVsMain: vi.fn(),
  resolveProjectForIssue: vi.fn(),
  writeRecordScopeDriftSync: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const exec = mocks.exec;
  Object.assign(exec, {
    [Symbol.for('nodejs.util.promisify.custom')]: (command: string, options: unknown) =>
      Promise.resolve(mocks.exec(command, options)),
  });
  const execFile = mocks.execFile;
  Object.assign(execFile, {
    [Symbol.for('nodejs.util.promisify.custom')]: (command: string, args: string[], options: unknown) =>
      Promise.resolve(mocks.execFile(command, args, options)),
  });
  return { ...actual, exec, execFile };
});

vi.mock('../../../src/lib/xbrief/io.js', () => ({
  readWorkspacePlanSync: mocks.readWorkspacePlanSync,
}));

vi.mock('../../../src/lib/flywheel-merge-order.js', () => ({
  changedFilesVsMain: mocks.changedFilesVsMain,
}));

vi.mock('../../../src/lib/pan-dir/record.js', () => ({
  appendSessionEntrySync: vi.fn(),
  getProjectConfigFromWorkspacePath: vi.fn(),
  readIssueRecordSync: vi.fn(),
  readRecordContinueViewSync: vi.fn(),
  resolveProjectForIssue: mocks.resolveProjectForIssue,
  writeRecordDecisionsSync: vi.fn(),
  writeRecordScopeDriftSync: mocks.writeRecordScopeDriftSync,
}));

import { Effect } from 'effect';
import { recordScopeDriftForDone } from '../../../src/cli/commands/done.js';

const planDoc = {
  plan: {
    items: [{ id: 'a', metadata: { files_scope: ['src/'] } }],
  },
};

describe('recordScopeDriftForDone — diff provenance (PAN-3847)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exec.mockReturnValue({ stdout: '', stderr: '' });
    mocks.execFile.mockReturnValue({ stdout: '', stderr: '' });
    mocks.readWorkspacePlanSync.mockReturnValue(planDoc);
    mocks.changedFilesVsMain.mockReturnValue(Effect.succeed(['src/foo.ts']));
    mocks.resolveProjectForIssue.mockReturnValue({
      projectKey: 'overdeck',
      path: '/project',
      workspace: { pr_target: 'develop' },
    });
  });

  it('fetches origin/<target> and diffs against origin/<target>', async () => {
    await recordScopeDriftForDone('PAN-3847', '/project/workspaces/feature-pan-3847');

    const execFileCalls = mocks.execFile.mock.calls.map((call) => call[1] as string[]);
    expect(execFileCalls).toContainEqual(['fetch', 'origin', '--', 'develop']);

    expect(mocks.changedFilesVsMain).toHaveBeenCalledWith(
      'HEAD',
      '/project/workspaces/feature-pan-3847',
      'origin/develop',
    );
    expect(mocks.writeRecordScopeDriftSync).toHaveBeenCalled();
  });

  it('still diffs when the fetch fails (non-fatal, cached ref)', async () => {
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const argv = args[1] as string[];
      if (argv[0] === 'fetch') throw new Error('offline');
      return { stdout: '', stderr: '' };
    });

    await recordScopeDriftForDone('PAN-3847', '/project/workspaces/feature-pan-3847');

    expect(mocks.changedFilesVsMain).toHaveBeenCalledWith(
      'HEAD',
      '/project/workspaces/feature-pan-3847',
      'origin/develop',
    );
  });
});
