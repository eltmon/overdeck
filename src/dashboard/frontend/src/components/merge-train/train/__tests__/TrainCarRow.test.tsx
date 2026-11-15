/**
 * PAN-4753 WI-10 (FR-20, R3): a car row's pill, its one action and the route
 * that action posts to, the Merge-alone confirm for a live-batch member, and
 * the expanded detail.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrainCarRow } from '../TrainCarRow';
import { callsTo, car, mockFetch, renderWithClient } from './fixtures';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(async (_opts: { title: string; message: string }) => true) }));

vi.mock('../../../DialogProvider', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

function renderRow(overrides: Parameters<typeof car>[0] = {}) {
  return renderWithClient(<TrainCarRow car={car(overrides)} order={1} projectKey="overdeck" projectName="overdeck" />);
}

describe('TrainCarRow', () => {
  beforeEach(() => {
    mocks.confirm.mockClear();
    mocks.confirm.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['cooldown', 'Cooling down'],
    ['merging', 'Merging'],
    ['blocked', 'Blocked'],
    ['failed', 'Last merge failed'],
    ['held', 'Waiting for batch'],
    ['ready', 'Ready'],
  ] as const)('%s shows its pill', (state, text) => {
    mockFetch({});
    renderRow({ state, mergeAt: state === 'cooldown' ? new Date(Date.now() + 60_000).toISOString() : null });
    expect(screen.getByTestId('car-pill-PAN-1').textContent).toContain(text);
  });

  it('Cancel during the cooldown deletes the auto-merge row', async () => {
    const fetchImpl = mockFetch({ 'DELETE /api/merge-train/auto-merge/PAN-1': { ok: true } });
    renderRow({ state: 'cooldown', mergeAt: new Date(Date.now() + 60_000).toISOString(), autoMergeRowId: 7 });
    fireEvent.click(screen.getByTestId('car-cancel-PAN-1'));
    await waitFor(() => expect(callsTo(fetchImpl, 'DELETE', '/api/merge-train/auto-merge/PAN-1')).toHaveLength(1));
  });

  it('Retry after a failure posts the issue merge after a confirm', async () => {
    const fetchImpl = mockFetch({ 'POST /api/issues/PAN-1/merge': { success: true } });
    renderRow({ state: 'failed' });
    fireEvent.click(screen.getByTestId('car-retry-PAN-1'));
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/api/issues/PAN-1/merge')).toHaveLength(1));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it('Merge posts merge-next for this car', async () => {
    const fetchImpl = mockFetch({ 'POST /api/merge-train/merge-next': { outcomes: [{ issueId: 'PAN-1', result: 'merged' }] } });
    renderRow({ state: 'ready' });
    fireEvent.click(screen.getByTestId('car-merge-PAN-1'));
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/api/merge-train/merge-next')).toHaveLength(1));
    const [, init] = callsTo(fetchImpl, 'POST', '/api/merge-train/merge-next')[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ n: 1, project: 'overdeck', issueId: 'PAN-1' });
  });

  it('Merge on a live-batch member asks first, naming the batch it voids', async () => {
    const fetchImpl = mockFetch({});
    mocks.confirm.mockResolvedValue(false);
    renderRow({ state: 'held', liveBatch: 'uat/pan-train-1114-2' });
    fireEvent.click(screen.getByTestId('car-merge-PAN-1'));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm.mock.calls[0]![0].message).toBe(
      'Merge PAN-1 alone? This voids batch pan-train-1114-2; its other members wait for the next batch.',
    );
    expect(callsTo(fetchImpl, 'POST', '/api/merge-train/merge-next')).toHaveLength(0);
  });

  it('merging and blocked cars offer no action', () => {
    mockFetch({});
    renderRow({ state: 'merging' });
    expect(screen.queryByRole('button', { name: /^(Merge|Retry|Cancel)$/ })).toBeNull();
  });

  it('expanded: branch, ready N ago, blockers, UAT notes and the step tracker', () => {
    mockFetch({});
    renderRow({
      state: 'failed',
      readyAt: new Date(Date.now() - 22 * 60_000).toISOString(),
      step: 'rebasing',
      notes: 'rebase conflict in src/x.ts',
      blockers: [{ type: 'merge_conflict', summary: 'conflicts with main', details: 'src/x.ts' }],
      uatNotes: 'Open the inspector and check it loads in under a second.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Expand PAN-1' }));
    const detail = screen.getByTestId('train-car-detail-PAN-1');
    expect(detail.textContent).toContain('feature/pan-1');
    expect(detail.textContent).toContain('#11');
    expect(detail.textContent).toContain('ready 22m ago');
    expect(detail.textContent).toContain('Merge policy');
    expect(screen.getByTestId('blocker-list').textContent).toContain('src/x.ts');
    expect(screen.getByTestId('car-uat-notes-PAN-1').textContent).toContain('under a second');
    expect(screen.getByTestId('merge-step-tracker').textContent).toContain('rebase conflict in src/x.ts');
  });
});
