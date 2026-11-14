/**
 * PAN-4753 WI-10 (FR-19): one project's card. Mode chip, the Train switch
 * posting the project override, the train-off banners, the hero batch and
 * queue heading by mode, D4's window line, and live-batch members rendered
 * as batch chips rather than queue rows.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTrainCard, pickHeroBatch } from '../ProjectTrainCard';
import type { BoardProject } from '../boardTypes';
import { callsTo, car, gen, mockFetch, project, renderWithClient } from './fixtures';

vi.mock('../../../DialogProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

function renderCard(p: BoardProject, masterEnabled = true) {
  return renderWithClient(<ProjectTrainCard project={p} masterEnabled={masterEnabled} />);
}

const HOLD = project({
  projectKey: 'myn',
  projectName: 'mind-your-now',
  repo: 'eltmon/mind-your-now',
  forge: 'gitlab',
  polyrepo: ['frontend', 'api'],
  mode: 'hold',
  batches: [gen(), gen({ name: 'uat/min-otter-1101-3', status: 'superseded', statusReason: 'replaced by uat/min-otter-1101-4' })],
  cars: [
    car({ issueId: 'MIN-1102', state: 'held', route: 'batch', liveBatch: 'uat/min-otter-1101-4' }),
    car({ issueId: 'MIN-1107', title: 'Calendar: two-way sync', state: 'failed', route: 'batch' }),
  ],
});

describe('ProjectTrainCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the mode chip and repo line', () => {
    mockFetch({});
    renderCard(project());
    expect(screen.getByTestId('mode-chip-overdeck').textContent).toBe('Auto-merge');
    expect(screen.getByTestId('merge-train-project-overdeck').textContent).toContain('eltmon/overdeck · github');
    mockFetch({});
    renderCard(HOLD);
    expect(screen.getByTestId('mode-chip-myn').textContent).toBe('Holds for UAT');
  });

  it('the Train switch posts the project override', async () => {
    const fetchImpl = mockFetch({ 'POST /api/projects/overdeck/merge-train': { value: 'disabled', effective: false } });
    renderCard(project());
    fireEvent.click(screen.getByTestId('merge-train-switch-overdeck'));
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/api/projects/overdeck/merge-train')).toHaveLength(1));
    const [, init] = callsTo(fetchImpl, 'POST', '/api/projects/overdeck/merge-train')[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ value: 'disabled' });
  });

  it('turning the switch back on clears the override', async () => {
    const fetchImpl = mockFetch({ 'POST /api/projects/overdeck/merge-train': { value: null, effective: true } });
    renderCard(project({ enabled: false, override: 'disabled' }));
    fireEvent.click(screen.getByTestId('merge-train-switch-overdeck'));
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/api/projects/overdeck/merge-train')).toHaveLength(1));
    const [, init] = callsTo(fetchImpl, 'POST', '/api/projects/overdeck/merge-train')[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ value: null });
  });

  it('shows the train-off banner, and the master banner when every project is off', () => {
    mockFetch({});
    const { unmount } = renderCard(project({ enabled: false, override: 'disabled' }));
    expect(screen.getByTestId('train-off-banner-overdeck').textContent).toContain('Train off.');
    unmount();
    renderCard(project({ enabled: false }), false);
    expect(screen.getByTestId('train-off-banner-overdeck').textContent).toContain('Merge train is off for all projects.');
  });

  it('a hold project shows the hero batch, the older batch row and "Not in a batch yet"', () => {
    mockFetch({});
    renderCard(HOLD);
    expect(screen.getByTestId('hero-batch-myn').textContent).toContain('min-otter-1101-4');
    expect(screen.getByTestId('older-batch-min-otter-1101-3').textContent).toContain('superseded');
    expect(screen.getByTestId('train-queue-myn').textContent).toContain('Not in a batch yet (1)');
    expect(screen.getByTestId('merge-train-project-myn').textContent).toContain('Each feature spans frontend + api.');
  });

  it('a live-batch member renders as a batch chip, not a queue row', () => {
    mockFetch({});
    renderCard(HOLD);
    expect(screen.queryByTestId('train-car-MIN-1102')).toBeNull();
    expect(screen.getByTestId('batch-member-MIN-1102')).toBeTruthy();
    expect(screen.getByTestId('train-car-MIN-1107')).toBeTruthy();
  });

  it('an auto project with no batches shows no batch section and "Waiting to merge"', () => {
    mockFetch({});
    renderCard(project({ cars: [car(), car({ issueId: 'PAN-2', state: 'cooldown', mergeAt: new Date(Date.now() + 60_000).toISOString() })] }));
    expect(screen.queryByTestId('hero-batch-overdeck')).toBeNull();
    expect(screen.getByTestId('train-queue-overdeck').textContent).toContain('Waiting to merge (2)');
    expect(screen.getByTestId('merge-train-project-overdeck').textContent).toContain('Each ready feature merges on its own 5 minutes after it is ready.');
  });

  it('D4: an auto project with a window batch renders it, with the window intro', () => {
    mockFetch({});
    renderCard(project({
      window: { size: 3, waitMinutes: 30, waiting: 0, nextBatchAt: null },
      batches: [gen({ name: 'uat/pan-train-1114-1', status: 'ready' })],
    }));
    expect(screen.getByTestId('hero-batch-overdeck').textContent).toContain('pan-train-1114-1');
    expect(screen.getByTestId('merge-train-project-overdeck').textContent).toContain('Ready features merge together in batches of 3, or after 30 minutes.');
  });

  describe('next batch line', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
    });

    it('counts down to the next batch and says now when it is due', () => {
      mockFetch({});
      renderCard(project({
        window: { size: 3, waitMinutes: 30, waiting: 2, nextBatchAt: '2026-11-14T12:12:00.000Z' },
        cars: [car({ state: 'held', route: 'batch' }), car({ issueId: 'PAN-2', state: 'held', route: 'batch' })],
      }));
      expect(screen.getByTestId('next-batch-overdeck').textContent).toBe('Next batch in 12 min: 2 of 3 waiting');
      act(() => { vi.advanceTimersByTime(12 * 60_000); });
      expect(screen.getByTestId('next-batch-overdeck').textContent).toBe('Next batch now: 2 of 3 waiting');
    });
  });

  it('a failed project read renders one muted line', () => {
    mockFetch({});
    renderCard(project({ error: 'gh pr list failed: rate limited' }));
    expect(screen.getByTestId('merge-train-error-overdeck').textContent).toBe('gh pr list failed: rate limited');
    expect(screen.queryByTestId('train-queue-overdeck')).toBeNull();
  });
});

describe('pickHeroBatch', () => {
  it('prefers the newest assembling/ready batch, then superseded', () => {
    const a = gen({ name: 'uat/a', status: 'invalidated' });
    const b = gen({ name: 'uat/b', status: 'superseded' });
    const c = gen({ name: 'uat/c', status: 'ready' });
    expect(pickHeroBatch([a, b, c])?.name).toBe('uat/c');
    expect(pickHeroBatch([a, b])?.name).toBe('uat/b');
    expect(pickHeroBatch([a])).toBeNull();
  });
});

/** Ported from the retired view's PAN-4598 retry-assembly tests (review of #5300). */
describe('ProjectTrainCard retry batch assembly', () => {
  afterEach(() => vi.unstubAllGlobals());

  const FAILED = gen({ name: 'uat/pan-onyx-0920-6', status: 'failed' });
  const twoHeld = [
    car({ issueId: 'PAN-1', state: 'held', route: 'batch' }),
    car({ issueId: 'PAN-2', state: 'held', route: 'batch' }),
  ];

  it('offers Retry batch assembly when the newest batch failed and none is testable, and POSTs a forced assemble', async () => {
    const fetchImpl = mockFetch({ 'POST /api/merge-train/assemble': { projects: [{ projectKey: 'overdeck', result: { action: 'assembled' } }] } });
    renderCard(project({ batches: [FAILED], cars: twoHeld }));
    fireEvent.click(screen.getByTestId('merge-train-retry-assembly-overdeck'));
    await waitFor(() => expect(callsTo(fetchImpl, 'POST', '/api/merge-train/assemble')).toHaveLength(1));
    const [, init] = callsTo(fetchImpl, 'POST', '/api/merge-train/assemble')[0]!;
    expect(JSON.parse(String(init!.body))).toEqual({ project: 'overdeck' });
  });

  it('a newer non-failed batch means the failure is history: no retry', () => {
    mockFetch({});
    renderCard(project({ batches: [gen({ name: 'uat/pan-onyx-1024', status: 'invalidated' }), FAILED], cars: twoHeld }));
    expect(screen.queryByTestId('merge-train-retry-assembly-overdeck')).toBeNull();
  });

  it('one unheld feature merges on its own: no retry that could not build a batch', () => {
    mockFetch({});
    renderCard(project({ batches: [FAILED], cars: [car({ issueId: 'PAN-1', state: 'ready', route: 'auto-merge' })] }));
    expect(screen.queryByTestId('merge-train-retry-assembly-overdeck')).toBeNull();
  });

  it('with the train off: no retry and no Merge buttons, since merge-next refuses', () => {
    mockFetch({});
    renderCard(project({ enabled: false, batches: [FAILED], cars: twoHeld }));
    expect(screen.queryByTestId('merge-train-retry-assembly-overdeck')).toBeNull();
    expect(screen.queryByTestId('car-merge-PAN-1')).toBeNull();
  });

  it('the train-off banner says held features wait in a hold project', () => {
    mockFetch({});
    renderCard(project({ mode: 'hold', enabled: false }));
    expect(screen.getByTestId('train-off-banner-overdeck').textContent).toContain('features held for UAT wait until the train is on again');
  });
});
