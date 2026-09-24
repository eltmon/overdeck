import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { FlywheelDerivedStatus } from '@overdeck/contracts';

export const NOW = Date.parse('2026-09-23T10:00:00.000Z');

export function flywheelStatus(overrides: Partial<FlywheelDerivedStatus> = {}): FlywheelDerivedStatus {
  return {
    run: 'running',
    conversation: {
      name: 'conv-flywheel', id: 42, title: 'Flywheel', model: 'claude-opus-5-5', harness: 'claude-code', cwd: '/repos/overdeck', sessionAlive: true,
    },
    lastTick: { tick: 3, pick: 'PAN-3964', phase: 'watch', inFlight: ['PAN-3964'], needsYou: null, at: '2026-09-23T09:59:40.000Z' },
    freshness: 'live',
    policies: { auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: false },
    inFlight: [
      {
        issueId: 'PAN-3964',
        state: 'in-review',
        attention: 'needs-you',
        pr: { url: 'https://github.com/eltmon/overdeck/pull/4001', number: 4001, reviewState: 'review-requested', checks: 'pending', mergeable: null },
        lastJournal: { at: '2026-09-23T09:55:00.000Z', type: 'review.dispatched', source: 'pan-done' },
      },
      { issueId: 'PAN-3920', state: 'working', lastJournal: null },
    ],
    orderBook: null,
    projectRoot: '/repos/overdeck',
    generatedAt: '2026-09-23T10:00:00.000Z',
    ...overrides,
  };
}

export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

/** Route fetch by URL; unmatched URLs answer `{}` so stray reads never throw. */
export function stubFetch(handler: Handler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return (await handler(url, init)) ?? Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
