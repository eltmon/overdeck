/**
 * UAT batches card tests (PAN-1737) — the three mockup states render from API
 * data, confirms gate every merge, and the stack button reflects stack status.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  mocks.confirm.mockClear();
  mocks.confirm.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('empty state', () => {
  it('explains the card instead of erroring on empty data', async () => {
    mockFetch({ 'uat-generations': [], 'merge-queue': [] });
    renderCard();
    expect(await screen.findByText(/No features are ready to merge/)).toBeTruthy();
  });

  it('warns when the merge backend is unavailable', async () => {
    mockFetch({
      'uat-generations': [],
      'merge-queue': [],
      'merge-backend': {
        available: false,
        mode: 'none',
        detail: 'No GitHub App credentials or gh CLI authentication found',
      },
    });
    renderCard();

    expect(await screen.findByText(/Merge backend unavailable/)).toBeTruthy();
    expect(screen.getByText(/autonomous merge disabled/)).toBeTruthy();
  });

  it('does not warn when the merge backend is available', async () => {
    mockFetch({
      'uat-generations': [],
      'merge-queue': [],
      'merge-backend': {
        available: true,
        mode: 'gh-cli',
        detail: 'gh CLI is authenticated',
      },
    });
    renderCard();

    expect(await screen.findByText(/No features are ready to merge/)).toBeTruthy();
    expect(screen.queryByText(/Merge backend unavailable/)).toBeNull();
  });
});

describe('steady state', () => {
  it('renders batches newest-first with honest actions, checklist, and branch/PR rows', async () => {
    mockFetch({ 'uat-generations': [READY_GEN, SUPERSEDED_GEN], 'merge-queue': QUEUE });
    renderCard();

    // batches
    expect(await screen.findByText('pan-otter-0610')).toBeTruthy();
    expect(screen.getByText('ready to test')).toBeTruthy();
    expect(screen.getByText('superseded · still testable')).toBeTruthy();
    expect(screen.getByText('Merge batch (2) to main')).toBeTruthy();
    expect(screen.getByText(/1 conflict resolved in batch/)).toBeTruthy();

    // stack button states: absent → start; running → link
    expect(screen.getByText(/Start & open UAT frontend/)).toBeTruthy();
    const openLink = screen.getByText('▶ Open').closest('a');
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
    expect(screen.getByText('Merge one feature to main…')).toBeTruthy();
    const legacyBatchLabel = new RegExp(['Ship', 'batch'].join(' '));
    expect(screen.queryByText(legacyBatchLabel)).toBeNull();
  });
});

describe('assembling state', () => {
  it('shows the building generation while the current batch stays actionable', async () => {
    mockFetch({ 'uat-generations': [ASSEMBLING_GEN, READY_GEN], 'merge-queue': QUEUE });
    renderCard();

    expect(await screen.findByText('pan-copper-fox-0610')).toBeTruthy();
    expect(screen.getByText(/assembling…/)).toBeTruthy();
    expect(screen.getByText(/stays testable until this one is ready/)).toBeTruthy();
    expect(screen.getByText('Merge batch (2) to main')).toBeTruthy();
  });
});

describe('confirm gating', () => {
  it('promote confirms with the exact members; cancelling fires nothing', async () => {
    const fetchMock = mockFetch({ 'uat-generations': [READY_GEN], 'merge-queue': QUEUE });
    mocks.confirm.mockResolvedValueOnce(false);
    renderCard();

    fireEvent.click(await screen.findByText('Merge batch (2) to main'));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    const options = mocks.confirm.mock.calls[0]![0] as { title: string; message: string };
    expect(options.title).toContain('pan-otter-0610');
    expect(options.message).toContain('PAN-1 (feature/pan-1) — Loading-wedge fix');
    expect(options.message).toContain('PAN-2 (feature/pan-2) — Transcript paths');
    expect(options.message).toContain('exactly the tree you tested');
    // cancelled → no POST fired
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(posts).toHaveLength(0);
  });

  it('confirming promote POSTs to the generation promote endpoint', async () => {
    const fetchMock = mockFetch({
      'uat-generations': [READY_GEN],
      'merge-queue': QUEUE,
      'POST promote': { success: true, mergeSha: 'm', members: ['PAN-1', 'PAN-2'] },
    });
    renderCard();

    fireEvent.click(await screen.findByText('Merge batch (2) to main'));

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
      expect(posts.map(([url]) => String(url))).toContain('/api/flywheel/uat-generations/pan-otter-0610/promote');
    });
  });

  it('the escape hatch names the queue head and its bypass consequence', async () => {
    mockFetch({ 'uat-generations': [READY_GEN], 'merge-queue': QUEUE, 'POST merge-next': { outcomes: [] } });
    mocks.confirm.mockResolvedValueOnce(false);
    renderCard();

    fireEvent.click(await screen.findByText('Merge one feature to main…'));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    const options = mocks.confirm.mock.calls[0]![0] as { title: string; message: string };
    expect(options.title).toContain('PAN-1');
    expect(options.message).toContain('bypasses batch testing');
  });
});
