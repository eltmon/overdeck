import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  clearReviewStatus: vi.fn(),
  loadReviewStatuses: vi.fn(() => ({})),
  markRecordPipelineClosedOutSync: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: mocks.exec,
  };
});

vi.mock('../tmux.js', () => ({
  killSession: vi.fn(() => Effect.void),
  listSessionNames: vi.fn(() => Effect.succeed([])),
  sessionExistsSync: vi.fn(() => false),
}));

vi.mock('../checkpoint/checkpoint-manager.js', () => ({
  pruneCheckpointRefsForAgents: vi.fn(() => Effect.void),
  pruneStaleCheckpointRefs: vi.fn(() => Effect.succeed(0)),
}));

vi.mock('../review-status.js', () => ({
  clearReviewStatus: mocks.clearReviewStatus,
  loadReviewStatuses: mocks.loadReviewStatuses,
}));

vi.mock('../pan-dir/records.js', () => ({
  markRecordPipelineClosedOutSync: mocks.markRecordPipelineClosedOutSync,
}));

import { executeCloseOut } from '../close-out.js';

describe('executeCloseOut terminal journal marker (PAN-2054)', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'pan-close-out-'));
    vi.clearAllMocks();
    mocks.loadReviewStatuses.mockReturnValue({});
    mocks.exec.mockImplementation((command: string, _opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof _opts === 'function' ? _opts : callback;
      if (command.includes('git branch --list')) cb?.(null, { stdout: '', stderr: '' });
      else if (command.includes('git ls-remote')) cb?.(null, { stdout: '', stderr: '' });
      else cb?.(null, { stdout: '', stderr: '' });
      return { on: vi.fn() };
    });
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('marks the pipeline journal terminal before clearing review status', async () => {
    const result = await Effect.runPromise(executeCloseOut({
      issueId: 'PAN-2054',
      projectPath,
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 2054,
    }));

    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.name === 'Mark pipeline terminal')?.status).toBe('passed');
    expect(mocks.markRecordPipelineClosedOutSync).toHaveBeenCalledWith(
      { name: 'inferred', path: projectPath },
      'PAN-2054',
    );
    expect(mocks.clearReviewStatus).toHaveBeenCalledWith('PAN-2054');
    expect(mocks.markRecordPipelineClosedOutSync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearReviewStatus.mock.invocationCallOrder[0],
    );
    const commands = mocks.exec.mock.calls.map((call) => String(call[0]));
    expect(commands).toContain(
      'gh issue edit 2054 --repo eltmon/overdeck --remove-label "merged" 2>/dev/null || true',
    );
    expect(commands).toContain(
      'gh issue edit 2054 --repo eltmon/overdeck --remove-label "ready" 2>/dev/null || true',
    );
  });

  it('records a skipped marker step without aborting close-out when the marker throws', async () => {
    mocks.markRecordPipelineClosedOutSync.mockImplementationOnce(() => {
      throw new Error('record write failed');
    });

    const result = await Effect.runPromise(executeCloseOut({
      issueId: 'PAN-2054',
      projectPath,
      isGitHub: true,
      owner: 'eltmon',
      repo: 'overdeck',
      number: 2054,
    }));

    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.name === 'Mark pipeline terminal')).toMatchObject({
      status: 'skipped',
      message: 'Warning: record write failed',
    });
    expect(mocks.clearReviewStatus).toHaveBeenCalledWith('PAN-2054');
  });
});
