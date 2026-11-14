/**
 * PAN-4753 WI-10: the strike lane's pills and actions. Merge posts the
 * operator strike door; a flagged strike shows the reviewer's summary and no
 * Merge; merging during the bot review asks first.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrikeLane } from '../StrikeLane';
import type { TrainStrike } from '../boardTypes';
import { callsTo, mockFetch, renderWithClient, strike } from './fixtures';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(async (_opts: { title: string }) => true) }));

vi.mock('../../../DialogProvider', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

function renderLane(strikes: TrainStrike[]) {
  return renderWithClient(<StrikeLane strikes={strikes} />);
}

describe('StrikeLane', () => {
  beforeEach(() => {
    mocks.confirm.mockClear();
    mocks.confirm.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the heading and nothing for an empty lane', () => {
    mockFetch({});
    const { container, unmount } = renderLane([]);
    expect(container.textContent).toBe('');
    unmount();
    renderLane([strike(), strike({ issueId: 'PAN-10' })]);
    expect(screen.getByTestId('strike-lane').textContent).toContain('Strike PRs (2) · front of the train');
  });

  it.each([
    ['checks-pending', 'Checks running', false],
    ['reviewing', 'Bot review running', true],
    ['flagged', 'Flagged by review', false],
    ['waiting-uat', 'Waits for UAT', true],
    ['queued', 'Merging next', false],
    ['failed', 'Last merge failed', false],
    ['blocked', 'Blocked', false],
    ['ready', 'Approved', true],
  ] as const)('%s reads "%s" (Merge shown: %s)', (state, text, hasMerge) => {
    mockFetch({});
    renderLane([strike({ state })]);
    expect(screen.getByTestId('strike-pill-PAN-9').textContent).toBe(text);
    expect(screen.queryByTestId('strike-merge-PAN-9') !== null).toBe(hasMerge);
  });

  it('a merging strike shows its step', () => {
    mockFetch({});
    renderLane([strike({ state: 'merging', step: 'squash-merging' })]);
    expect(screen.getByTestId('strike-pill-PAN-9').textContent).toBe('Merging · step 8 of 9');
  });

  it('Merge posts the strike merge route', async () => {
    const fetchImpl = mockFetch({ 'POST /api/merge-train/strikes/PAN-9/merge': { success: true } });
    renderLane([strike({ state: 'ready' })]);
    fireEvent.click(screen.getByTestId('strike-merge-PAN-9'));
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/api/merge-train/strikes/PAN-9/merge')).toHaveLength(1));
  });

  it('Retry on a failed strike posts the same route', async () => {
    const fetchImpl = mockFetch({ 'POST /api/merge-train/strikes/PAN-9/merge': { success: true } });
    renderLane([strike({ state: 'failed' })]);
    fireEvent.click(screen.getByTestId('strike-retry-PAN-9'));
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/api/merge-train/strikes/PAN-9/merge')).toHaveLength(1));
  });

  it('a flagged strike shows the review summary and offers no Merge', () => {
    mockFetch({});
    renderLane([strike({ state: 'flagged', reviewSummary: 'The health probe is still referenced by the deacon.' })]);
    expect(screen.queryByTestId('strike-merge-PAN-9')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand PAN-9' }));
    expect(screen.getByTestId('strike-review-summary-PAN-9').textContent).toContain('still referenced by the deacon');
  });

  it('Merge while the bot review runs asks first', async () => {
    const fetchImpl = mockFetch({});
    mocks.confirm.mockResolvedValue(false);
    renderLane([strike({ state: 'reviewing' })]);
    fireEvent.click(screen.getByTestId('strike-merge-PAN-9'));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm.mock.calls[0]![0].title).toBe('Merge without the bot review?');
    expect(callsTo(fetchImpl, 'POST', '/api/merge-train/strikes/')).toHaveLength(0);
  });
});
