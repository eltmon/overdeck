import { describe, expect, it, vi } from 'vitest';

import { strikeReadyCommand, type StrikeReadyDependencies } from '../strike-ready.js';
import type { ReviewStatus } from '../../../lib/review-status.js';

const head = 'a'.repeat(40);
const projectRoot = '/repo';
const workspace = '/repo/workspaces/feature-pan-2702-strike';

function status(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-2702',
    reviewStatus: 'pending',
    testStatus: 'pending',
    updatedAt: '2026-07-16T12:00:00.000Z',
    readyForMerge: false,
    ...overrides,
  };
}

function dependencies(overrides: Partial<StrikeReadyDependencies> = {}): StrikeReadyDependencies {
  const current = status();
  return {
    cwd: workspace,
    now: () => '2026-07-16T12:00:00.000Z',
    resolveProject: vi.fn().mockReturnValue({ projectPath: projectRoot, projectKey: 'overdeck' }),
    getStatus: vi.fn().mockReturnValue(current),
    setStatus: vi.fn((issueId, update) => status({ issueId, ...update })),
    git: vi.fn(async (args) => {
      const command = args.join(' ');
      if (command === 'rev-parse --show-toplevel') return workspace;
      if (command === 'branch --show-current') return 'strike/pan-2702';
      if (command === 'worktree list --porcelain') {
        return `worktree ${workspace}\nHEAD ${head}\nbranch refs/heads/strike/pan-2702\n`;
      }
      if (command === 'status --porcelain' || command.startsWith('fetch ')) return '';
      if (command === 'rev-parse HEAD' || command === 'rev-parse origin/strike/pan-2702') return head;
      throw new Error(`Unexpected git command: ${command}`);
    }),
    ...overrides,
  };
}

describe('strikeReadyCommand', () => {
  it('persists a verified pushed strike HEAD through the status writer', async () => {
    const deps = dependencies();
    const result = await strikeReadyCommand('PAN-2702', deps);

    expect(deps.setStatus).toHaveBeenCalledWith('PAN-2702', {
      strikeReadyHead: head,
      strikeReadyAt: '2026-07-16T12:00:00.000Z',
      strikeLandingState: 'ready',
      strikeRecoveryCount: 0,
      strikeLandingAttempts: [],
    });
    expect(result.strikeReadyHead).toBe(head);
  });

  it.each([
    ['wrong workspace', { cwd: '/repo', git: vi.fn().mockResolvedValue('/repo') }],
    ['dirty worktree', { git: vi.fn(async (args: string[]) => args[0] === 'status' ? ' M file.ts' : dependencies().git(args, workspace)) }],
    ['unpushed HEAD', { git: vi.fn(async (args: string[]) => args.join(' ') === 'rev-parse origin/strike/pan-2702' ? 'b'.repeat(40) : dependencies().git(args, workspace)) }],
  ])('rejects %s without mutating the marker', async (_name, override) => {
    const deps = dependencies(override as Partial<StrikeReadyDependencies>);
    await expect(strikeReadyCommand('PAN-2702', deps)).rejects.toThrow();
    expect(deps.setStatus).not.toHaveBeenCalled();
  });

  it('treats an identical HEAD as idempotent', async () => {
    const existing = status({
      strikeReadyHead: head,
      strikeReadyAt: '2026-07-16T11:00:00.000Z',
      strikeLandingState: 'recovering',
      strikeRecoveryCount: 2,
      strikeLandingAttempts: [{ timestamp: 't', strikeHead: head, mainHead: 'm', outcome: 'failed', detail: 'conflict' }],
    });
    const deps = dependencies({ getStatus: vi.fn().mockReturnValue(existing) });

    await expect(strikeReadyCommand('PAN-2702', deps)).resolves.toBe(existing);
    expect(deps.setStatus).not.toHaveBeenCalled();
  });

  it('resets a new HEAD readiness cycle while preserving attempt history', async () => {
    const attempts = [{ timestamp: 't', strikeHead: 'b'.repeat(40), mainHead: 'm', outcome: 'failed', detail: 'conflict' }];
    const deps = dependencies({
      getStatus: vi.fn().mockReturnValue(status({ strikeReadyHead: 'b'.repeat(40), strikeRecoveryCount: 2, strikeLandingAttempts: attempts })),
    });

    await strikeReadyCommand('PAN-2702', deps);
    expect(deps.setStatus).toHaveBeenCalledWith('PAN-2702', expect.objectContaining({
      strikeRecoveryCount: 0,
      strikeLandingAttempts: attempts,
    }));
  });
});

