/**
 * PAN-4753 WI-10: the batch card. A voided batch shows "voided" and its
 * stored reason; Merge batch is offered only for promotable statuses and asks
 * inline; the WI-9 stack-unhealthy refusal needs a reason to merge anyway;
 * a live batch's member chip offers Merge alone, which confirms first.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchCard } from '../BatchCard';
import type { UatGenerationPayload } from '../boardTypes';
import { callsTo, errorResponse, gen, mockFetch, renderWithClient } from './fixtures';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(async (_opts: { title: string; message: string }) => true) }));

vi.mock('../../../DialogProvider', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const PROMOTE = 'POST /api/merge-train/generations/min-otter-1101-4/promote';

function renderCard(g: UatGenerationPayload, hero = true) {
  return renderWithClient(<BatchCard gen={g} projectKey="myn" projectName="mind-your-now" hero={hero} />);
}

describe('BatchCard', () => {
  beforeEach(() => {
    mocks.confirm.mockClear();
    mocks.confirm.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an invalidated batch shows "voided" and its status reason, with no Merge button', () => {
    mockFetch({});
    renderCard(gen({ status: 'invalidated', statusReason: 'MIN-1102 was merged on its own, outside the batch' }), false);
    expect(screen.getByTestId('batch-status-min-otter-1101-4').textContent).toBe('voided');
    expect(screen.getByTestId('batch-reason-min-otter-1101-4').textContent).toBe('MIN-1102 was merged on its own, outside the batch');
    expect(screen.queryByTestId('batch-merge-min-otter-1101-4')).toBeNull();
  });

  it('a superseded batch is still testable and promotable and shows its reason', () => {
    mockFetch({});
    renderCard(gen({ status: 'superseded', statusReason: 'replaced by uat/min-otter-1101-5' }), false);
    expect(screen.getByTestId('batch-status-min-otter-1101-4').textContent).toBe('superseded');
    expect(screen.getByTestId('batch-reason-min-otter-1101-4').textContent).toContain('replaced by');
    expect(screen.getByTestId('batch-merge-min-otter-1101-4')).toBeTruthy();
  });

  it.each([
    ['ready', true],
    ['superseded', true],
    ['assembling', false],
    ['invalidated', false],
    ['promoted', false],
    ['failed', false],
  ] as const)('%s: Merge batch button present = %s', (status, present) => {
    mockFetch({});
    renderCard(gen({ status }));
    expect(screen.queryByTestId('batch-merge-min-otter-1101-4') !== null).toBe(present);
  });

  it('a ready batch reads "ready to test" and lists held-out members with reasons', () => {
    mockFetch({});
    renderCard(gen({ heldOut: [{ issueId: 'MIN-1109', reason: 'conflict with main in web/src/pages/Today.tsx' }] }));
    expect(screen.getByTestId('batch-status-min-otter-1101-4').textContent).toBe('ready to test');
    expect(screen.getByTestId('batch-held-MIN-1109').textContent).toContain('held out · conflict with main');
  });

  it('Merge batch asks inline, then promotes', async () => {
    const fetchImpl = mockFetch({ [PROMOTE]: { mergeSha: 'abc', members: ['MIN-1102', 'MIN-1106'] } });
    renderCard(gen());
    fireEvent.click(screen.getByTestId('batch-merge-min-otter-1101-4'));
    expect(screen.getByTestId('batch-merge-confirm-min-otter-1101-4').textContent).toContain('Lands exactly the tree you tested.');
    expect(callsTo(fetchImpl, 'POST', '/promote')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('batch-merge-confirm-submit-min-otter-1101-4'));
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/promote')).toHaveLength(1));
  });

  it('stack-unhealthy: shows the message, and Merge anyway requires a reason', async () => {
    const fetchImpl = mockFetch({
      [PROMOTE]: errorResponse(409, { success: false, reason: 'stack-unhealthy', message: 'UAT stack is degraded; start it and test, or merge anyway with a reason' }),
    });
    renderCard(gen());
    fireEvent.click(screen.getByTestId('batch-merge-min-otter-1101-4'));
    fireEvent.click(screen.getByTestId('batch-merge-confirm-submit-min-otter-1101-4'));
    const panel = await screen.findByTestId('batch-stack-unhealthy-min-otter-1101-4');
    expect(panel.textContent).toContain('UAT stack is degraded');

    fireEvent.click(screen.getByRole('button', { name: 'Merge anyway…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge with this reason' }));
    expect(screen.getByText('A reason is required to merge without a healthy UAT stack.')).toBeTruthy();
    expect(callsTo(fetchImpl, 'POST', '/promote')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Why merge without a healthy UAT stack?'), { target: { value: 'tested on staging' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge with this reason' }));
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/promote')).toHaveLength(2));
    const [, init] = callsTo(fetchImpl, 'POST', '/promote')[1]!;
    expect(JSON.parse(String(init?.body))).toEqual({ overrideStackHealth: true, overrideReason: 'tested on staging' });
  });

  it('a live batch member offers Merge alone, which confirms naming the batch', async () => {
    const fetchImpl = mockFetch({ 'POST /api/merge-train/merge-next': { outcomes: [{ issueId: 'MIN-1102', result: 'merged' }] } });
    renderCard(gen());
    fireEvent.click(screen.getByTestId('batch-member-MIN-1102'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Merge alone…' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm.mock.calls[0]![0].message).toBe(
      'Merge MIN-1102 alone? This voids batch min-otter-1101-4; its other members wait for the next batch.',
    );
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/api/merge-train/merge-next')).toHaveLength(1));
    const [, init] = callsTo(fetchImpl, 'POST', '/api/merge-train/merge-next')[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ n: 1, project: 'myn', issueId: 'MIN-1102' });
  });

  it('the hero ready batch opens What to UAT, with the plan-not-found line', () => {
    mockFetch({});
    renderCard(gen());
    const uat = screen.getByTestId('batch-uat-min-otter-1101-4');
    expect(uat.textContent).toContain('Swipe left shows Snooze');
    expect(uat.textContent).toContain('Plan not found: no acceptance criteria. Exercise the feature described above.');
  });
});
