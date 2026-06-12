/**
 * UAT batches card tests (PAN-1737) — the three mockup states render from API
 * data, confirms gate every merge, and the stack button reflects stack status.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'sonner';
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
    if (url.includes('/api/dashboard/session')) return { ok: true, status: 200, json: async () => ({ csrfToken: 'test-csrf-token' }) } as Response;
    const method = init?.method ?? 'GET';
    const key = Object.keys(responses).find((k) => url.includes(k.split(' ').pop()!) && (k.includes(' ') ? k.startsWith(method) : method === 'GET'));
    if (!key) return { ok: true, json: async () => ({}) } as Response;
    return { ok: true, json: async () => responses[key] } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const QUEUE = [
  { issueId: 'PAN-1', title: 'Loading-wedge fix', branchName: 'feature/pan-1', pr: 11, prUrl: 'https://x/pull/11', mergeOrder: 1, conflictsWith: [] },
  { issueId: 'PAN-2', title: 'Transcript paths', branchName: 'feature/pan-2', mergeOrder: 2, conflictsWith: ['PAN-1'] },
];

const PROJECT_QUEUE = { projectKey: 'panopticon', projectName: 'Panopticon', enabled: true, queue: QUEUE };

function projectGenerations(generations: unknown[]) {
  return [{ projectKey: 'panopticon', projectName: 'Panopticon', generations }];
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
  stack: { status: 'absent', frontendUrl: 'https://uat-pan-otter-0610.pan.localhost' },
};

const SUPERSEDED_GEN = {
  ...READY_GEN,
  name: 'uat/pan-sea-monkey-0610',
  status: 'superseded',
  createdAt: '2026-06-10T01:00:00.000Z',
  members: [READY_GEN.members[0]],
  resolutions: [],
  stack: { status: 'running', frontendUrl: 'https://uat-pan-sea-monkey-0610.pan.localhost' },
};

const ASSEMBLING_GEN = {
  ...READY_GEN,
  name: 'uat/pan-copper-fox-0610',
  status: 'assembling',
  createdAt: '2026-06-10T03:00:00.000Z',
  resolutions: [],
  stack: { status: 'absent', frontendUrl: 'https://x' },
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MergeQueueCard active={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.confirm.mockClear();
  mocks.confirm.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('empty state', () => {
  it('explains the card instead of erroring on empty data', async () => {
    mockFetch({ generations: [], queues: [] });
    renderCard();
    expect(await screen.findByText(/No features are ready to merge/)).toBeTruthy();
  });
});

describe('steady state', () => {
  it('renders batches newest-first with honest actions, checklist, and branch/PR rows', async () => {
    mockFetch({ generations: projectGenerations([READY_GEN, SUPERSEDED_GEN]), queues: [PROJECT_QUEUE] });
    renderCard();

    // batches
    expect(await screen.findByText('Panopticon')).toBeTruthy();
    expect(await screen.findByText('pan-otter-0610')).toBeTruthy();
    expect(screen.getByText('ready to test')).toBeTruthy();
    expect(screen.getByText('superseded · still testable')).toBeTruthy();
    expect(screen.getByText('Merge batch (2) to main')).toBeTruthy();
    expect(screen.getByText(/1 conflict resolved in batch/)).toBeTruthy();

    // stack button states: absent → start; running → link
    expect(screen.getByText(/Start & open UAT frontend/)).toBeTruthy();
    const openLink = screen.getByText('Open').closest('a');
    expect(openLink?.getAttribute('href')).toBe('https://uat-pan-sea-monkey-0610.pan.localhost');

    // what-to-UAT: per-member ACs, no-steps fallback, touchpoint item
    expect(screen.getByText('Inspector opens in <1s')).toBeTruthy();
    expect(screen.getByText(/No UAT steps in plan/)).toBeTruthy();
    expect(screen.getByText(/verify both features still behave at that touchpoint/)).toBeTruthy();

    // ready rows: monospace branch + PR link
    expect(screen.getByText('feature/pan-1')).toBeTruthy();
    const pr = screen.getByText(/PR #11/).closest('a');
    expect(pr?.getAttribute('href')).toBe('https://x/pull/11');

    // escape hatch present, and no dishonest legacy label anywhere
    expect(screen.getByText('Merge one feature to main...')).toBeTruthy();
    const legacyBatchLabel = new RegExp(['Ship', 'batch'].join(' '));
    expect(screen.queryByText(legacyBatchLabel)).toBeNull();
  });

  it('renders grouped per-project generation payloads', async () => {
    mockFetch({
      generations: projectGenerations([READY_GEN]),
      queues: [PROJECT_QUEUE],
    });
    renderCard();

    expect(await screen.findByText('pan-otter-0610')).toBeTruthy();
    expect(screen.getByText('Merge batch (2) to main')).toBeTruthy();
  });
});

describe('project filtering', () => {
  it('renders one section per project and persists the selected filter', async () => {
    const mindQueue = {
      projectKey: 'mind',
      projectName: 'Mind',
      enabled: false,
      queue: [{ issueId: 'MIN-1', title: 'Mind task', branchName: 'feature/min-1', mergeOrder: 1, conflictsWith: [] }],
    };
    mockFetch({
      generations: [
        ...projectGenerations([READY_GEN]),
        { projectKey: 'mind', projectName: 'Mind', generations: [] },
      ],
      queues: [PROJECT_QUEUE, mindQueue],
    });
    const { unmount } = renderCard();

    expect((await screen.findAllByText('Panopticon')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mind').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Mind' }));
    expect(localStorage.getItem('merge-train.projectFilter')).toBe('mind');
    await waitFor(() => expect(screen.queryByText('pan-otter-0610')).toBeNull());
    expect(screen.getByText('MIN-1')).toBeTruthy();

    unmount();
    renderCard();
    expect(await screen.findByText('MIN-1')).toBeTruthy();
    expect(screen.queryByText('pan-otter-0610')).toBeNull();
  });
});

describe('assembling state', () => {
  it('shows the building generation while the current batch stays actionable', async () => {
    mockFetch({ generations: projectGenerations([ASSEMBLING_GEN, READY_GEN]), queues: [PROJECT_QUEUE] });
    renderCard();

    expect(await screen.findByText('pan-copper-fox-0610')).toBeTruthy();
    expect(screen.getByText(/assembling.../)).toBeTruthy();
    expect(screen.getByText(/stays testable until this one is ready/)).toBeTruthy();
    expect(screen.getByText('Merge batch (2) to main')).toBeTruthy();
  });
});

describe('confirm gating', () => {
  it('promote confirms with the exact members; cancelling fires nothing', async () => {
    const fetchMock = mockFetch({ generations: projectGenerations([READY_GEN]), queues: [PROJECT_QUEUE] });
    mocks.confirm.mockResolvedValueOnce(false);
    renderCard();

    fireEvent.click(await screen.findByText('Merge batch (2) to main'));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    const options = mocks.confirm.mock.calls[0]![0] as { title: string; message: string };
    expect(options.title).toContain('pan-otter-0610');
    expect(options.message).toContain('PAN-1 (feature/pan-1) - Loading-wedge fix');
    expect(options.message).toContain('PAN-2 (feature/pan-2) - Transcript paths');
    expect(options.message).toContain('exactly the tree you tested');
    // cancelled → no POST fired
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(0);
  });

  it('confirming promote POSTs to the generation promote endpoint', async () => {
    const fetchMock = mockFetch({
      generations: projectGenerations([READY_GEN]),
      queues: [PROJECT_QUEUE],
      'POST promote': { success: true, mergeSha: 'm', members: ['PAN-1', 'PAN-2'] },
    });
    renderCard();

    fireEvent.click(await screen.findByText('Merge batch (2) to main'));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      expect(posts.map(([url]) => String(url))).toContain('/api/merge-train/generations/pan-otter-0610/promote');
    });
  });

  it('confirming stack POSTs to the aggregate generation stack endpoint', async () => {
    const fetchMock = mockFetch({
      generations: projectGenerations([READY_GEN]),
      queues: [PROJECT_QUEUE],
      'POST stack': { frontendUrl: 'https://uat-pan-otter-0610.pan.localhost', evicted: [] },
    });
    vi.stubGlobal('open', vi.fn());
    renderCard();

    fireEvent.click(await screen.findByText('Start & open UAT frontend'));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    const options = mocks.confirm.mock.calls[0]![0] as { title: string; message: string };
    expect(options.title).toContain('pan-otter-0610');
    expect(options.message).toContain('PAN-1');

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      expect(posts.map(([url]) => String(url))).toContain('/api/merge-train/generations/pan-otter-0610/stack');
    });
  });

  it('the escape hatch names the queue head and its bypass consequence', async () => {
    mockFetch({ generations: projectGenerations([READY_GEN]), queues: [PROJECT_QUEUE], 'POST merge-next': { outcomes: [] } });
    mocks.confirm.mockResolvedValueOnce(false);
    renderCard();

    fireEvent.click(await screen.findByText('Merge one feature to main...'));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    const options = mocks.confirm.mock.calls[0]![0] as { title: string; message: string };
    expect(options.title).toContain('PAN-1');
    expect(options.message).toContain('bypasses batch testing');
  });

  it('handles grouped force-reconcile results from rebuild', async () => {
    mockFetch({
      generations: projectGenerations([READY_GEN]),
      queues: [PROJECT_QUEUE],
      'POST assemble': { panopticon: { action: 'assembled', invalidated: [] }, krux: { action: 'idle', invalidated: [] } },
    });
    renderCard();

    fireEvent.click(await screen.findByTitle(/Re-merge the ready features/));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rebuilt Panopticon UAT batch'));
  });

  it('confirming the escape hatch POSTs merge-next with the project key', async () => {
    const fetchMock = mockFetch({
      generations: projectGenerations([READY_GEN]),
      queues: [PROJECT_QUEUE],
      'POST merge-next': { outcomes: [{ issueId: 'PAN-1', result: 'merged' }] },
    });
    renderCard();

    fireEvent.click(await screen.findByText('Merge one feature to main...'));

    await waitFor(() => {
      const mergeNext = fetchMock.mock.calls.find(([url]) => String(url) === '/api/merge-train/merge-next');
      expect(mergeNext).toBeTruthy();
      expect(JSON.parse(String((mergeNext?.[1] as RequestInit).body))).toEqual({ n: 1, project: 'panopticon' });
    });
  });
});
