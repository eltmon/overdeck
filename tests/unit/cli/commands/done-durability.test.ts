import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendSessionEntrySync: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTtsSync: vi.fn(),
  getAgentStateSync: vi.fn(),
  getReviewStatusSync: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  shouldSkipTrackerUpdate: vi.fn(),
  updateIssueRecord: vi.fn(),
  updateShadowState: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, writeFileSync: mocks.writeFileSync };
});

vi.mock('../../../../src/lib/agents.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/agents.js')>('../../../../src/lib/agents.js');
  return {
    ...actual,
    getAgentStateSync: mocks.getAgentStateSync,
    saveAgentRuntimeState: mocks.saveAgentRuntimeState,
    saveAgentStateSync: mocks.saveAgentStateSync,
  };
});

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
  emitActivityTtsSync: mocks.emitActivityTtsSync,
}));

vi.mock('../../../../src/lib/shadow-mode.js', () => ({
  shouldSkipTrackerUpdate: mocks.shouldSkipTrackerUpdate,
}));

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  updateShadowState: mocks.updateShadowState,
}));

vi.mock('../../../../src/lib/pan-dir/record-update.js', () => ({
  updateIssueRecord: mocks.updateIssueRecord,
}));

vi.mock('../../../../src/lib/pan-dir/record.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/record.js')>('../../../../src/lib/pan-dir/record.js');
  return {
    ...actual,
    appendSessionEntrySync: mocks.appendSessionEntrySync,
    resolveProjectForIssue: vi.fn(() => ({ name: 'Overdeck', path: '/tmp/overdeck' })),
  };
});

vi.mock('../../../../src/lib/xbrief/io.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/xbrief/io.js')>('../../../../src/lib/xbrief/io.js');
  return { ...actual, readWorkspacePlanSync: vi.fn(() => null) };
});

vi.mock('../../../../src/lib/merge-set.js', () => ({
  ensureMergeSetForIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/review-artifacts.js', () => ({
  createReviewArtifactsForIssue: vi.fn(() => Effect.succeed({
    mergeSet: null,
    artifacts: [{ repoKey: 'primary', created: true, skipped: false, url: 'https://example.test/pr/1' }],
  })),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

import { doneCommand } from '../../../../src/cli/commands/done.js';

const ISSUE_ID = 'PAN-2840';
const AGENT_ID = 'agent-pan-2840';

describe('pan done canonical durability boundary', () => {
  let workspacePath: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    workspacePath = join(tmpdir(), `pan-done-durability-${process.pid}`);
    mkdirSync(workspacePath, { recursive: true });

    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getAgentStateSync.mockImplementation((agentId: string) => agentId === AGENT_ID ? {
      id: AGENT_ID,
      issueId: ISSUE_ID,
      role: 'work',
      status: 'running',
      workspace: workspacePath,
      lastActivity: '2026-07-18T00:00:00.000Z',
    } : null);
    mocks.getReviewStatusSync.mockReturnValue(null);
    mocks.updateIssueRecord
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Failed to push PAN-2840 state after 3 reconciliation attempts'));

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit:1');
    }) as never);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    exitSpy.mockRestore();
    fetchSpy.mockRestore();
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('does not advance tracker, runtime, cache, markers, or HTTP after the canonical write fails', async () => {
    await expect(doneCommand(ISSUE_ID, { force: true })).rejects.toThrow('process.exit:1');

    expect(mocks.updateIssueRecord).toHaveBeenCalledTimes(2);
    expect(mocks.shouldSkipTrackerUpdate).not.toHaveBeenCalled();
    expect(mocks.updateShadowState).not.toHaveBeenCalled();
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
    expect(mocks.saveAgentStateSync).not.toHaveBeenCalled();
    expect(mocks.saveAgentRuntimeState).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
    expect(mocks.appendSessionEntrySync).not.toHaveBeenCalled();
    expect(mocks.emitActivityEntrySync).not.toHaveBeenCalled();
    expect(mocks.emitActivityTtsSync).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
