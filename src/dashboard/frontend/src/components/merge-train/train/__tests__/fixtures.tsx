/**
 * Shared fixtures for the `MergeTrain` component tests (PAN-4753 WI-10):
 * board builders, a URL-keyed fetch mock, and a render helper with a fresh
 * QueryClient.
 */
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { BoardProject, MergeTrainBoard, TrainCar, TrainStrike, UatGenerationPayload } from '../boardTypes';

export function car(over: Partial<TrainCar> = {}): TrainCar {
  return {
    issueId: 'PAN-1',
    title: 'Loading-wedge fix',
    branch: 'feature/pan-1',
    prs: [{ label: '#11', url: 'https://github.com/x/y/pull/11' }],
    state: 'ready',
    route: 'auto-merge',
    policy: null,
    effectivePolicy: 'auto',
    policyWritable: true,
    readyAt: null,
    mergeAt: null,
    autoMergeRowId: null,
    step: null,
    notes: null,
    blockers: [],
    uatNotes: null,
    liveBatch: null,
    ...over,
  };
}

export function strike(over: Partial<TrainStrike> = {}): TrainStrike {
  return {
    issueId: 'PAN-9',
    title: 'Strike: drop the stale health probe',
    branch: 'strike/pan-9',
    prNumber: 4698,
    prUrl: 'https://github.com/x/y/pull/4698',
    state: 'ready',
    route: 'auto-merge',
    reviewSummary: null,
    notes: null,
    step: null,
    blockers: [],
    ...over,
  };
}

export function gen(over: Partial<UatGenerationPayload> = {}): UatGenerationPayload {
  return {
    name: 'uat/min-otter-1101-4',
    status: 'ready',
    baseSha: 'a41c9e2ffff',
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
    members: [
      { issueId: 'MIN-1102', title: 'Today view: swipe to snooze', branch: 'feature/min-1102', mergeOrder: 1, acceptanceCriteria: [{ title: 'Swipe left shows Snooze', status: 'pending' }] },
      { issueId: 'MIN-1106', title: 'Grocery list: merge duplicates', branch: 'feature/min-1106', mergeOrder: 2, acceptanceCriteria: [], planResolved: false },
    ],
    heldOut: [],
    resolutions: [],
    versionSyncConfigured: false,
    shipStatus: null,
    statusReason: null,
    stack: { status: 'absent', frontendUrl: 'https://uat.example' },
    ...over,
  };
}

export function project(over: Partial<BoardProject> = {}): BoardProject {
  return {
    projectKey: 'overdeck',
    projectName: 'overdeck',
    repo: 'eltmon/overdeck',
    forge: 'github',
    polyrepo: null,
    enabled: true,
    override: null,
    mode: 'auto',
    cooldownMinutes: 5,
    window: null,
    cars: [],
    strikes: [],
    batches: [],
    recent: [],
    ...over,
  };
}

export function board(projects: BoardProject[], masterEnabled = true): MergeTrainBoard {
  return { masterEnabled, projects };
}

interface MockErrorResponse { __mockKind: 'error'; status: number; body: unknown }

/** A non-2xx response for a `mockFetch` key. */
export function errorResponse(status: number, body: unknown): MockErrorResponse {
  return { __mockKind: 'error', status, body };
}

function isMockError(value: unknown): value is MockErrorResponse {
  return typeof value === 'object' && value !== null && (value as { __mockKind?: string }).__mockKind === 'error';
}

/** Keys are `'<METHOD> <url-substring>'`, or a bare url substring for GET. Longest match wins. */
export function mockFetch(responses: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/dashboard/session')) {
      return { ok: true, status: 200, json: async () => ({ csrfToken: 'test-csrf-token' }) } as Response;
    }
    const method = init?.method ?? 'GET';
    const key = Object.keys(responses)
      .filter((k) => url.includes(k.split(' ').pop()!) && (k.includes(' ') ? k.startsWith(`${method} `) : method === 'GET'))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return { ok: true, status: 200, json: async () => ({}) } as Response;
    const value = responses[key];
    if (isMockError(value)) {
      return { ok: false, status: value.status, json: async () => value.body } as Response;
    }
    return { ok: true, status: 200, json: async () => value } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Calls to `fetch` whose method and URL match. */
export function callsTo(fetchImpl: ReturnType<typeof vi.fn>, method: string, urlPart: string): Array<[string, RequestInit | undefined]> {
  return (fetchImpl.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>)
    .filter(([input, init]) => String(input).includes(urlPart) && (init?.method ?? 'GET') === method)
    .map(([input, init]) => [String(input), init]);
}

export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ...result, client };
}
