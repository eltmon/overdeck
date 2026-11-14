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
      name: 'conv-flywheel', id: 42, title: 'Flywheel', model: 'claude-opus-5-5', harness: 'claude-code', cwd: '/repos/overdeck', createdAt: '2026-09-23T08:00:00.000Z', sessionAlive: true,
    },
    lastTick: { tick: 3, pick: 'PAN-3964', phase: 'watch', inFlight: ['PAN-3964'], needsYou: null, at: '2026-09-23T09:59:40.000Z' },
    freshness: 'live',
    policies: { auto_pickup_backlog: false, require_uat_before_merge: true, merge_train_enabled: false },
    inFlight: [
      {
        issueId: 'PAN-3964',
        title: 'Restore the Flywheel page',
        state: 'in-review',
        liveAgents: 1,
        inTick: true,
        attention: 'needs-you',
        pr: { url: 'https://github.com/eltmon/overdeck/pull/4001', number: 4001, reviewState: 'review-requested', checks: 'pending', mergeable: null },
        lastJournal: { at: '2026-09-23T09:55:00.000Z', type: 'review.dispatched', source: 'pan-done' },
      },
      { issueId: 'PAN-3920', title: 'Register external agents', state: 'working', liveAgents: 0, inTick: false, lastJournal: null },
    ],
    agents: [{ issueId: 'PAN-3964', role: 'work', harness: 'claude-code', model: 'claude-opus-5-5', state: 'working' }],
    inFlightSource: 'tick',
    orderBook: null,
    projectRoot: '/repos/overdeck',
    generatedAt: '2026-09-23T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * A board-shaped status (PAN-5283): one row per lane, a gate-queued row, a
 * handoff agent, a failed check, and two shipped merges (one not deployed).
 */
export function boardStatus(overrides: Partial<FlywheelDerivedStatus> = {}): FlywheelDerivedStatus {
  const merge = (sha: string, deployed: boolean | null, prNumber: number, issueId: string, title: string) => ({
    sha: sha.repeat(40).slice(0, 40), at: '2026-09-23T09:00:00.000Z', subject: `feat: ${title} (#${prNumber})`, prNumber,
    prUrl: `https://github.com/eltmon/overdeck/pull/${prNumber}`, issueId, title, deployed,
  });
  return flywheelStatus({
    inFlight: [
      {
        issueId: 'PAN-5276', title: 'Add the shipped-today timeline to the Flywheel page', state: 'working', liveAgents: 0, inTick: false,
        lastJournal: { at: '2026-09-23T09:54:00.000Z', type: 'feedback.delivered' },
        stage: 'build', stageSince: '2026-09-23T09:18:00.000Z', owner: { kind: 'conversation', name: '20261114-d9c5', title: 'Handoff for PAN-5276' },
        agent: { role: 'handoff', model: 'claude-opus-5-5', harness: 'claude-code', state: 'working', conversationName: '20261114-d9c5' },
        blocker: null, cost: 3.1, lastActivity: { at: '2026-09-23T09:54:00.000Z', label: 'feedback delivered to agent' },
      },
      {
        issueId: 'PAN-5095', title: 'Move the cost rollup off the request path', state: 'working', liveAgents: 0, inTick: true,
        lastJournal: { at: '2026-09-23T09:42:00.000Z', type: 'verification.failed' },
        stage: 'build', stageSince: '2026-09-23T08:50:00.000Z', owner: { kind: 'flywheel' }, agent: null,
        blocker: { kind: 'test-removal-waiver', severity: 'needs-you', text: 'test-skip gate failed: needs your test-removal waiver', action: 'waive-test-removal' },
        cost: 7.84, lastActivity: { at: '2026-09-23T09:42:00.000Z', label: 'checks failed' },
      },
      {
        issueId: 'PAN-5275', title: 'Make the whole Needs-you row clickable', state: 'working', liveAgents: 1, inTick: true,
        lastJournal: { at: '2026-09-23T09:36:00.000Z', type: 'verification.started' },
        stage: 'checks', stageSince: '2026-09-23T09:36:00.000Z', owner: { kind: 'flywheel' },
        agent: { role: 'work', model: 'claude-sonnet-5', harness: 'claude-code', state: 'waiting', agentId: 'agent-pan-5275' },
        blocker: { kind: 'gate-queue', severity: 'waiting', text: 'typecheck queued: 11.5 GB free, needs 2.2 GB, gates keep 12.0 GB (20 min)' },
        cost: 1.92, lastActivity: { at: '2026-09-23T09:36:00.000Z', label: 'checks started' },
      },
      {
        issueId: 'PAN-5278', title: 'Stop review convoys wedging', state: 'in-review', liveAgents: 1, inTick: false,
        lastJournal: { at: '2026-09-23T09:44:00.000Z', type: 'review.dispatched' },
        stage: 'review', stageSince: '2026-09-23T09:44:00.000Z', owner: { kind: 'operator' },
        agent: { role: 'review', model: 'claude-opus-5-5', harness: 'claude-code', state: 'working' },
        blocker: null, cost: 2.4, lastActivity: { at: '2026-09-23T09:44:00.000Z', label: 'review started' },
        pr: { url: 'https://github.com/eltmon/overdeck/pull/5290', number: 5290, reviewState: 'review-requested', checks: 'pending', mergeable: null },
      },
      {
        issueId: 'PAN-5281', title: 'Apps/mobile typecheck lane', state: 'ready', liveAgents: 1, inTick: true, lastJournal: null,
        stage: 'merge', stageSince: '2026-09-23T09:55:00.000Z', owner: { kind: 'flywheel' },
        agent: { role: 'work', model: 'claude-sonnet-5', harness: 'claude-code', state: 'idle' },
        blocker: { kind: 'auto-merge-scheduled', severity: 'waiting', text: 'auto-merge at 10:20' }, cost: null, lastActivity: null,
      },
      {
        issueId: 'PAN-5290', title: 'Plan the next board', state: 'planned', liveAgents: 0, inTick: false, lastJournal: null,
        stage: 'plan', stageSince: null, owner: { kind: 'operator' }, agent: null, blocker: null, cost: null, lastActivity: null,
      },
    ],
    shipped: {
      merges: [merge('a', false, 5273, 'PAN-5246', 'Flywheel stats panel shows waste'), merge('c', true, 5270, 'PAN-5269', 'Fast-forwarded batch heads')],
      events: [],
    },
    ...overrides,
  });
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
