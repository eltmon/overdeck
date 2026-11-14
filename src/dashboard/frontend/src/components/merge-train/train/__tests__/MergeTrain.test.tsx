/**
 * PAN-4753 WI-10 (FR-19, FR-21): the MergeTrain component in both
 * placements. All projects: one card per project with something on its
 * train, the idle footer, filter chips that filter and persist (ported from
 * the retired view's tests). Project: one card in `#merge-train`.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MERGE_TRAIN_PROJECT_FILTER_KEY, MergeTrain, isIdleProject } from '../MergeTrain';
import { trainTotals } from '../useMergeTrainBoard';
import { board, car, gen, mockFetch, project, renderWithClient, strike } from './fixtures';

vi.mock('../../../DialogProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const OVERDECK = project({ cars: [car(), car({ issueId: 'PAN-2', title: 'Transcript paths' })] });
const MYN = project({
  projectKey: 'myn',
  projectName: 'mind-your-now',
  mode: 'hold',
  batches: [gen()],
  cars: [car({ issueId: 'MIN-1102', state: 'held', route: 'batch', liveBatch: 'uat/min-otter-1101-4' })],
});
const AURICLE = project({ projectKey: 'auricle', projectName: 'auricle' });
const BOARD = board([OVERDECK, MYN, AURICLE]);

describe('MergeTrain (all projects)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one card per project with something on its train, and the idle footer', async () => {
    mockFetch({ '/api/merge-train/board': BOARD });
    renderWithClient(<MergeTrain placement="all-projects" />);
    await screen.findByTestId('merge-train-project-overdeck');
    expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy();
    expect(screen.queryByTestId('merge-train-project-auricle')).toBeNull();
    expect(screen.getByTestId('merge-train-idle-footer').textContent).toBe('1 project with nothing to merge: auricle');
  });

  it('reads the all-projects board without a project filter', async () => {
    const fetchImpl = mockFetch({ '/api/merge-train/board': BOARD });
    renderWithClient(<MergeTrain placement="all-projects" />);
    await screen.findByTestId('merge-train-project-overdeck');
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toContain('/api/merge-train/board');
  });

  it('filter chips filter the cards and persist the selection', async () => {
    mockFetch({ '/api/merge-train/board': BOARD });
    renderWithClient(<MergeTrain placement="all-projects" />);
    await screen.findByTestId('merge-train-project-overdeck');
    const filter = screen.getByTestId('merge-train-project-filter');
    fireEvent.click(Array.from(filter.querySelectorAll('button')).find((b) => b.textContent === 'mind-your-now')!);
    expect(screen.queryByTestId('merge-train-project-overdeck')).toBeNull();
    expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(MERGE_TRAIN_PROJECT_FILTER_KEY)!)).toEqual(['myn']);

    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy();
    expect(window.localStorage.getItem(MERGE_TRAIN_PROJECT_FILTER_KEY)).toBeNull();
  });

  it('restores a stored filter on mount and prunes unknown projects', async () => {
    window.localStorage.setItem(MERGE_TRAIN_PROJECT_FILTER_KEY, JSON.stringify(['myn', 'gone']));
    mockFetch({ '/api/merge-train/board': BOARD });
    renderWithClient(<MergeTrain placement="all-projects" />);
    await screen.findByTestId('merge-train-project-myn');
    expect(screen.queryByTestId('merge-train-project-overdeck')).toBeNull();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(MERGE_TRAIN_PROJECT_FILTER_KEY)!)).toEqual(['myn']));
  });

  it('a project that failed to load still renders its card with the error', async () => {
    mockFetch({ '/api/merge-train/board': board([project({ error: 'gh pr list failed' }), MYN]) });
    renderWithClient(<MergeTrain placement="all-projects" />);
    expect((await screen.findByTestId('merge-train-error-overdeck')).textContent).toBe('gh pr list failed');
    expect(screen.getByTestId('merge-train-project-myn')).toBeTruthy();
  });

  it('says so when nothing is waiting anywhere', async () => {
    mockFetch({ '/api/merge-train/board': board([AURICLE]) });
    renderWithClient(<MergeTrain placement="all-projects" />);
    expect(await screen.findByText('Nothing is waiting to merge. When work passes review and checks, it lines up here.')).toBeTruthy();
  });
});

describe('MergeTrain (project)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders that project card inside #merge-train and reads the scoped board', async () => {
    const fetchImpl = mockFetch({ '/api/merge-train/board?project=myn': board([MYN]) });
    const { container } = renderWithClient(<MergeTrain placement="project" projectKey="myn" />);
    await screen.findByTestId('merge-train-project-myn');
    expect(container.querySelector('#merge-train')).toBeTruthy();
    expect(screen.queryByTestId('merge-train-project-filter')).toBeNull();
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toContain('/api/merge-train/board?project=myn');
  });
});

describe('isIdleProject and trainTotals', () => {
  it('an enabled project with nothing on it is idle; disabled or errored never is', () => {
    expect(isIdleProject(AURICLE)).toBe(true);
    expect(isIdleProject(project({ enabled: false }))).toBe(false);
    expect(isIdleProject(project({ error: 'x' }))).toBe(false);
    expect(isIdleProject(project({ batches: [gen({ status: 'invalidated' })] }))).toBe(true);
    expect(isIdleProject(project({ strikes: [strike()] }))).toBe(false);
  });

  it('counts waiting cars outside live batches, ready batches and strikes', () => {
    expect(trainTotals(board([OVERDECK, MYN, project({ strikes: [strike()] })]))).toEqual({ waiting: 2, batchesReady: 1, strikes: 1 });
    expect(trainTotals(undefined)).toEqual({ waiting: 0, batchesReady: 0, strikes: 0 });
  });
});
