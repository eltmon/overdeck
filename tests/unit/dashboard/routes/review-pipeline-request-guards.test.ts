/**
 * PAN-3847 W18 — re-review is refused on a dirty working tree or when the PR
 * is already approved at its current head; it proceeds otherwise.
 *
 * PAN-3917: "already approved" is the forge's answer, read from the derived
 * issue state. There is no stored anchor to compare a workspace HEAD against
 * and no review-status row to reset, so the guard asks the PR and stops there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DerivedIssueState } from '@overdeck/contracts';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const exec = mocks.exec;
  Object.assign(exec, {
    [Symbol.for('nodejs.util.promisify.custom')]: (command: string, options: unknown) =>
      Promise.resolve(mocks.exec(command, options)),
  });
  return { ...actual, exec };
});

import { reReviewGuardError } from '../../../../src/dashboard/server/routes/workspaces/review-pipeline.js';

const workspaceInfo = { isRemote: false } as never;
const workspacePath = '/project/workspaces/feature-pan-3847';

function derived(reviewState: 'approved' | 'changes-requested' | 'pending'): DerivedIssueState {
  return {
    issueId: 'PAN-3847',
    state: 'in-review',
    pr: {
      url: 'https://github.com/eltmon/overdeck/pull/3847',
      number: 3847,
      reviewState,
      checks: 'green',
      mergeable: true,
    },
  } as DerivedIssueState;
}

describe('reReviewGuardError (PAN-3847)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exec.mockReturnValue({ stdout: '', stderr: '' });
  });

  it('dirty tree → 409 shape with the committed-HEAD hint', async () => {
    mocks.exec.mockReturnValue({ stdout: ' M src/foo.ts\n', stderr: '' });

    const guard = await reReviewGuardError('PAN-3847', workspacePath, workspaceInfo, derived('pending'));

    expect(guard).not.toBeNull();
    expect(guard!.error).toBe('working tree is dirty');
    expect(guard!.hint).toContain('Reviewers only see committed HEAD');
  });

  it('clean tree, the PR is approved at its current head → 409 shape', async () => {
    const guard = await reReviewGuardError('PAN-3847', workspacePath, workspaceInfo, derived('approved'));

    expect(guard).not.toBeNull();
    expect(guard!.error).toBe('HEAD already approved');
    expect(guard!.hint).toContain('#3847');
  });

  it('clean tree, the PR is not approved → no guard (proceeds)', async () => {
    const guard = await reReviewGuardError('PAN-3847', workspacePath, workspaceInfo, derived('changes-requested'));

    expect(guard).toBeNull();
  });

  it('clean tree, no derived state (forced review) → no guard (proceeds)', async () => {
    const guard = await reReviewGuardError('PAN-3847', workspacePath, workspaceInfo, null);

    expect(guard).toBeNull();
  });
});
