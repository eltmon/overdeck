/**
 * PAN-4199 WI-12 — the UAT batches rail card. The card owns only its label and
 * its count; the body is `MergeTrainView`, tested on its own.
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../DialogProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { FlywheelUatBatchesCard, uatBatchesCountLabel } from '../FlywheelUatBatchesCard';
import { renderWithQuery, stubFetch } from './fixtures';

const QUEUE = [
  { issueId: 'PAN-1', title: 'Loading-wedge fix', branchName: 'feature/pan-1', pr: 11, prUrl: 'https://x/pull/11', mergeOrder: 1, conflictsWith: [] },
  { issueId: 'PAN-2', title: 'Transcript paths', branchName: 'feature/pan-2', mergeOrder: 2, conflictsWith: [] },
];

const READY_GEN = {
  name: 'uat/pan-otter-0610',
  status: 'ready',
  baseSha: 'abc',
  createdAt: '2026-06-10T02:00:00.000Z',
  updatedAt: '',
  members: [{ issueId: 'PAN-1', title: 'Loading-wedge fix', branch: 'feature/pan-1', mergeOrder: 1, acceptanceCriteria: [] }],
  heldOut: [],
  resolutions: [],
  stack: { status: 'absent', frontendUrl: 'https://x' },
};

function setup(queue: unknown[], generations: unknown[]) {
  return stubFetch((url) => {
    if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 't' });
    if (url.includes('/api/merge-train/queues')) {
      return Response.json([{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue }]);
    }
    if (url.includes('/api/merge-train/generations')) {
      return Response.json([{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations }]);
    }
    return undefined;
  });
}

describe('FlywheelUatBatchesCard (PAN-4199 WI-12)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pluralizes the count label and hides it when the train is empty', () => {
    expect(uatBatchesCountLabel(2, 1)).toBe('2 features · 1 batch');
    expect(uatBatchesCountLabel(1, 2)).toBe('1 feature · 2 batches');
    expect(uatBatchesCountLabel(0, 0)).toBeNull();
  });

  it('shows the label and the queued/batched counts (ac1)', async () => {
    setup(QUEUE, [READY_GEN]);
    renderWithQuery(<FlywheelUatBatchesCard />);
    expect(screen.getByRole('region', { name: 'UAT batches' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('flywheel-uat-batches-count')).toHaveTextContent('2 features · 1 batch'));
  });

  it('renders the label but no count when nothing is queued or batched (ac2)', async () => {
    setup([], []);
    renderWithQuery(<FlywheelUatBatchesCard />);
    expect(screen.getByRole('region', { name: 'UAT batches' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('flywheel-uat-batches-count')).toBeNull());
  });
});
