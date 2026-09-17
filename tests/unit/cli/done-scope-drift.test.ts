/**
 * PAN-3847 W17 — pan done's scope-drift diff fetches origin/<target> first and
 * diffs against origin/<target> from the project config, never a hardcoded or
 * remembered local main.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
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
  return { ...actual, exec };
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

    const execCommands = mocks.exec.mock.calls.map((call) => String(call[0]));
    expect(execCommands).toContain('git fetch origin develop');

    expect(mocks.changedFilesVsMain).toHaveBeenCalledWith(
      'HEAD',
      '/project/workspaces/feature-pan-3847',
      'origin/develop',
    );
    expect(mocks.writeRecordScopeDriftSync).toHaveBeenCalled();
  });

  it('still diffs when the fetch fails (non-fatal, cached ref)', async () => {
    mocks.exec.mockImplementation((command: string) => {
      if (String(command).startsWith('git fetch')) throw new Error('offline');
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
