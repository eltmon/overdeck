/**
 * PAN-4753 WI-10 (FR-19, FR-21): the MergeTrain component in both
 * placements. All projects: one card per project with something on its
 * train, the idle footer, filter chips that filter and persist (ported from
 * the retired view's tests). Project: one card in `#merge-train`.
 */
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MERGE_TRAIN_PROJECT_FILTER_KEY, MergeTrain, isIdleProject } from '../MergeTrain';
import { MERGE_TRAIN_BOARD_KEY, normalizeBoard, trainTotals, useApplyProjectTrainWrite } from '../useMergeTrainBoard';
import type { MergeTrainBoard } from '../boardTypes';
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

describe('MergeTrain notices (PAN-5277 no-loss audit)', () => {
  it('says when no merge backend is configured', async () => {
    mockFetch({ '/api/merge-train/board': BOARD, '/api/merge-train/merge-backend': { available: false, mode: 'none', detail: '' } });
    renderWithClient(<MergeTrain placement="all-projects" />);
    expect((await screen.findByTestId('merge-backend-unavailable')).textContent).toContain('Merge backend unavailable');
  });

  it('shows a project-wide scheduler skip on the card and keeps that project out of the idle footer', async () => {
    const skipped = project({ projectKey: 'auricle', projectName: 'auricle', notices: ['Not scheduled: the PR listing could not be read'] });
    expect(isIdleProject(skipped)).toBe(false);
    mockFetch({ '/api/merge-train/board': board([OVERDECK, skipped]) });
    renderWithClient(<MergeTrain placement="all-projects" />);
    expect((await screen.findByTestId('train-notice-auricle')).textContent).toBe('Not scheduled: the PR listing could not be read');
  });
});

describe('MergeTrain with a malformed board answer', () => {
  it('renders an empty train instead of throwing when the board read answers {}', async () => {
    mockFetch({});
    renderWithClient(<MergeTrain placement="project" projectKey="overdeck" />);
    expect(await screen.findByTestId('merge-train')).toBeInTheDocument();
  });

  it('normalizeBoard fills every list', () => {
    expect(normalizeBoard({ projects: [{ projectKey: 'p' }] })).toEqual({
      masterEnabled: true,
      projects: [{ projectKey: 'p', window: null, notices: [], cars: [], strikes: [], batches: [], recent: [] }],
    });
    expect(normalizeBoard(null)).toEqual({ masterEnabled: true, projects: [] });
  });
});

/** PAN-5363: the Train switch shows the confirmed write without flickering back to a stale board read. */
describe('Train switch writes (PAN-5363)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function deferredPromise<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  /** Each GET of `/api/merge-train/board` consumes the next queued value; past the queue, it hangs forever. */
  function stubFetchWithBoardQueue(queue: Array<MergeTrainBoard | Promise<MergeTrainBoard>>): ReturnType<typeof vi.fn> {
    let next = 0;
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/dashboard/session')) {
        return { ok: true, status: 200, json: async () => ({ csrfToken: 'test-csrf-token' }) } as Response;
      }
      if (method === 'POST' && url.includes('/api/projects/overdeck/merge-train')) {
        return { ok: true, status: 200, json: async () => ({ value: 'disabled', effective: false }) } as Response;
      }
      if (method === 'GET' && url.includes('/api/merge-train/board')) {
        const entry = queue[next++] ?? new Promise<MergeTrainBoard>(() => {});
        const value = await entry;
        return { ok: true, status: 200, json: async () => value } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  const boardOn = () => board([project({ override: null, enabled: true })]);
  const boardOff = () => board([project({ override: 'disabled', enabled: false })]);
  const switchNode = () => screen.getByTestId('merge-train-switch-overdeck') as HTMLButtonElement;

  it('the switch stays off after the POST while the board refetch is pending', async () => {
    stubFetchWithBoardQueue([boardOn()]);
    renderWithClient(<MergeTrain placement="project" projectKey="overdeck" />);
    await screen.findByTestId('merge-train-project-overdeck');

    fireEvent.click(switchNode());
    // The mutation's success and the board-cache patch land via separate scheduled
    // notifications, so both conditions must be polled together, not asserted once
    // right after the first one passes.
    await waitFor(() => {
      expect(switchNode().disabled).toBe(false);
      expect(switchNode().getAttribute('aria-checked')).toBe('false');
    });
    expect(screen.getByTestId('train-off-banner-overdeck')).toBeTruthy();
  });

  it('a board read in flight at the click is discarded', async () => {
    const d1 = deferredPromise<MergeTrainBoard>();
    const d2 = deferredPromise<MergeTrainBoard>();
    stubFetchWithBoardQueue([boardOn(), d1.promise, d2.promise]);
    const { client } = renderWithClient(<MergeTrain placement="project" projectKey="overdeck" />);
    await screen.findByTestId('merge-train-project-overdeck');

    await act(async () => { void client.refetchQueries({ queryKey: MERGE_TRAIN_BOARD_KEY }); });

    fireEvent.click(switchNode());
    await waitFor(() => {
      expect(switchNode().disabled).toBe(false);
      expect(switchNode().getAttribute('aria-checked')).toBe('false');
    });

    d1.resolve(boardOn());
    await act(async () => { await d1.promise; });
    await waitFor(() => expect(switchNode().getAttribute('aria-checked')).toBe('false'));

    d2.resolve(boardOff());
    await act(async () => { await d2.promise; });
    await waitFor(() => expect(switchNode().getAttribute('aria-checked')).toBe('false'));
  });

  it('useApplyProjectTrainWrite patches every board placement and the settings query', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(['merge-train', 'board', 'all'], board([
      project({ projectKey: 'overdeck' }),
      project({ projectKey: 'myn', projectName: 'mind-your-now' }),
    ]));
    client.setQueryData(['merge-train', 'board', 'overdeck'], board([project({ projectKey: 'overdeck' })]));

    const { result } = renderHook(() => useApplyProjectTrainWrite(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => { await result.current('overdeck', { value: 'disabled', effective: false }); });

    const all = client.getQueryData<MergeTrainBoard>(['merge-train', 'board', 'all']);
    const scoped = client.getQueryData<MergeTrainBoard>(['merge-train', 'board', 'overdeck']);
    expect(all?.projects.find((p) => p.projectKey === 'overdeck')).toMatchObject({ override: 'disabled', enabled: false });
    expect(all?.projects.find((p) => p.projectKey === 'myn')).toMatchObject({ override: null, enabled: true });
    expect(scoped?.projects.find((p) => p.projectKey === 'overdeck')).toMatchObject({ override: 'disabled', enabled: false });
    expect(client.getQueryData(['project-merge-train', 'overdeck'])).toEqual({ value: 'disabled', effective: false });
  });
});
