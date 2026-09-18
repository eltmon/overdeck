/**
 * UAT batches rail card tests.
 *
 * PAN-1696 turned this card into a RailCard shell around the shared
 * <MergeTrainView>: the batch/checklist/action rendering is covered by
 * components/merge-train/__tests__/MergeTrainView.test.tsx, so what remains to
 * prove here is the wrapper contract — the card reads the aggregate endpoints
 * (never the legacy per-repo pair), renders the shared view, labels itself from
 * the same data, and populates with NO flywheel run active.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MergeQueueCard } from '../MergeQueueCard';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
}));

vi.mock('../../DialogProvider', () => ({
  useConfirm: () => mocks.confirm,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

type FetchResponses = Record<string, unknown>;

function mockFetch(responses: FetchResponses): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/dashboard/session')) {
      return { ok: true, status: 200, json: async () => ({ csrfToken: 'test-csrf-token' }) } as Response;
    }
    const method = init?.method ?? 'GET';
    const key = Object.keys(responses).find(
      (k) => url.includes(k.split(' ').pop()!) && (k.includes(' ') ? k.startsWith(method) : method === 'GET'),
    );
    if (!key) return { ok: true, json: async () => ({}) } as Response;
    return { ok: true, json: async () => responses[key] } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const READY_GEN = {
  name: 'uat/pan-otter-0610',
  status: 'ready',
  baseSha: 'abc',
  createdAt: '2026-06-10T02:00:00.000Z',
  updatedAt: '',
  members: [
    { issueId: 'PAN-1', title: 'Loading-wedge fix', branch: 'feature/pan-1', pr: 11, prUrl: 'https://x/pull/11', mergeOrder: 1, acceptanceCriteria: [{ title: 'Inspector opens in <1s', status: 'pending' }] },
    { issueId: 'PAN-2', title: 'Transcript paths', branch: 'feature/pan-2', mergeOrder: 2, acceptanceCriteria: [] },
  ],
  heldOut: [],
  resolutions: [{ issueIds: ['PAN-2', 'PAN-1'], files: ['src/x.ts'], commitSha: 'r1' }],
  stack: { status: 'absent', frontendUrl: 'https://uat-pan-otter-0610.overdeck.localhost' },
};

const POPULATED: FetchResponses = {
  '/api/merge-train/queues': [
    {
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      enabled: true,
      queue: [
        { issueId: 'PAN-1', title: 'Loading-wedge fix', branchName: 'feature/pan-1', pr: 11, prUrl: 'https://x/pull/11', mergeOrder: 1, conflictsWith: [] },
        { issueId: 'PAN-2', title: 'Transcript paths', branchName: 'feature/pan-2', mergeOrder: 2, conflictsWith: ['PAN-1'] },
      ],
    },
  ],
  '/api/merge-train/generations': [
    { projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: [READY_GEN] },
  ],
  '/api/flywheel/merge-backend': { available: true, mode: 'gh-cli', detail: 'ok' },
};

function renderCard(props: { active?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MergeQueueCard {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.confirm.mockClear();
  mocks.confirm.mockResolvedValue(true);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('MergeQueueCard as a merge-train viewer (PAN-1696)', () => {
  it('renders the shared merge-train view inside the rail card (ac1)', async () => {
    mockFetch(POPULATED);
    renderCard();

    expect(await screen.findByLabelText('UAT batches')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('merge-train-view')).toBeTruthy());
    expect(screen.getByTestId('merge-train-project-overdeck').textContent).toContain('pan-otter-0610');
  });

  it('reads the aggregate endpoints and never the legacy per-repo pair (ac1)', async () => {
    const fetchMock = mockFetch(POPULATED);
    renderCard();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/merge-train/queues'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/merge-train/generations'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/flywheel/uat-generations'))).toBe(false);
    expect(urls.some((u) => u.includes('/api/flywheel/merge-queue'))).toBe(false);
  });

  it('populates with no flywheel run active — even with active=false (ac2)', async () => {
    // active=false only stops polling; the reads still happen, which is exactly
    // what the old run-gated card could not do.
    mockFetch(POPULATED);
    renderCard({ active: false });

    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());
    expect(screen.getByText('pan-otter-0610')).toBeTruthy();
    expect(screen.getByText(/Merge batch \(2\) to main/)).toBeTruthy();
  });

  it('labels the card with the cross-project feature and batch counts', async () => {
    mockFetch(POPULATED);
    renderCard();
    await waitFor(() => expect(screen.getByTestId('merge-train-project-overdeck')).toBeTruthy());

    // The project section header shows its own per-project count, so scope the
    // assertion to the rail card's own header rather than the whole tree.
    const card = screen.getByLabelText('UAT batches');
    const header = card.querySelector('button, [class*="uppercase"]')?.closest('div') ?? card;
    expect(header.textContent).toContain('2 features · 1 batch');
  });

  it('omits the count when nothing is ready anywhere', async () => {
    mockFetch({
      '/api/merge-train/queues': [{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: [] }],
      '/api/merge-train/generations': [],
    });
    renderCard();

    expect(await screen.findByText(/No features are ready to merge in any project/)).toBeTruthy();
    expect(screen.queryByText(/feature · /)).toBeNull();
  });

  it('surfaces the merge-backend warning through the shared view', async () => {
    mockFetch({ ...POPULATED, '/api/flywheel/merge-backend': { available: false, mode: 'none', detail: 'no auth' } });
    renderCard();
    expect(await screen.findByText('Merge backend unavailable')).toBeTruthy();
  });
});
