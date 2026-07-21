import { describe, expect, it, vi } from 'vitest';

import {
  strikeReadyCommand,
  type StrikeReadyDependencies,
} from '../../../../src/cli/commands/strike-ready.js';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';

const head = 'a'.repeat(40);
const previousHead = 'b'.repeat(40);
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

function dependencies(previous: ReviewStatus): StrikeReadyDependencies {
  return {
    cwd: workspace,
    now: () => '2026-07-16T12:00:00.000Z',
    resolveProject: vi.fn().mockReturnValue({ projectPath: projectRoot, projectKey: 'overdeck' }),
    getStatus: vi.fn().mockReturnValue(previous),
    setStatus: vi.fn((issueId, update) => status({ issueId, ...update })),
    clearStuck: vi.fn(),
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
  };
}

const attempts = [{
  timestamp: 't',
  strikeHead: previousHead,
  mainHead: 'main',
  outcome: 'failed',
  detail: 'conflict',
}];

describe('strikeReadyCommand recovery re-arm', () => {
  it.each(['recovering', 'needs_you'] as const)(
    're-arms the same pushed head from %s',
    async (strikeLandingState) => {
      const previous = status({
        strikeReadyHead: head,
        strikeReadyAt: '2026-07-16T11:00:00.000Z',
        strikeLandingState,
        strikeRecoveryCount: 2,
        strikeTransportRetryCount: 3,
        strikeNextAttemptAt: '2026-07-16T12:30:00.000Z',
        strikeLandingAttempts: attempts,
      });
      const deps = dependencies(previous);

      await strikeReadyCommand('PAN-2702', deps);

      expect(deps.clearStuck).toHaveBeenCalledWith('PAN-2702');
      expect(deps.setStatus).toHaveBeenCalledWith('PAN-2702', {
        strikeLandingState: 'ready',
        strikeRecoveryCount: 0,
        strikeTransportRetryCount: undefined,
        strikeNextAttemptAt: undefined,
        strikeLandingAttempts: attempts,
      });
    },
  );

  it.each(['ready', 'landing'] as const)(
    'keeps the same pushed head in %s unchanged',
    async (strikeLandingState) => {
      const previous = status({ strikeReadyHead: head, strikeLandingState });
      const deps = dependencies(previous);

      await expect(strikeReadyCommand('PAN-2702', deps)).resolves.toBe(previous);
      expect(deps.clearStuck).not.toHaveBeenCalled();
      expect(deps.setStatus).not.toHaveBeenCalled();
    },
  );

  it('clears transport backoff when signaling a new pushed head', async () => {
    const previous = status({
      strikeReadyHead: previousHead,
      strikeTransportRetryCount: 3,
      strikeNextAttemptAt: '2026-07-16T12:30:00.000Z',
      strikeLandingAttempts: attempts,
    });
    const deps = dependencies(previous);

    await strikeReadyCommand('PAN-2702', deps);

    expect(deps.setStatus).toHaveBeenCalledWith('PAN-2702', {
      strikeReadyHead: head,
      strikeReadyAt: '2026-07-16T12:00:00.000Z',
      strikeLandingState: 'ready',
      strikeRecoveryCount: 0,
      strikeTransportRetryCount: undefined,
      strikeNextAttemptAt: undefined,
      strikeLandingAttempts: attempts,
    });
  });
});
