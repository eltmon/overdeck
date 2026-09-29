/**
 * PAN-4399 — the "Start work" Needs-you card names the reason a gave-up
 * post-planning auto-start never produced a work agent, instead of the
 * generic "Plan ready" label a plan simply awaiting its first start gets.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../DialogProvider', () => ({
  useAlert: () => vi.fn(),
  useConfirm: () => vi.fn(async () => true),
}));

import { NeedsYouRow } from './NeedsYouStrip';
import { deriveSimpleIssue } from '../../lib/simple/derive';
import type { DerivedIssueState, Issue } from '../../types';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'PAN-4399',
    identifier: 'PAN-4399',
    title: 'Post-planning auto-spawn fails silently',
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: '',
    state: 'in_progress',
    ...overrides,
  } as Issue;
}

function renderRow(derived: DerivedIssueState) {
  const item = deriveSimpleIssue(makeIssue(), [], derived, []);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NeedsYouRow item={item} kind="start-work" onOpen={() => {}} />
    </QueryClientProvider>,
  );
}

describe('NeedsYouRow — work-not-started (PAN-4399)', () => {
  it('shows "Work agent not started", the recorded error, and an enabled Start work button', () => {
    renderRow({
      issueId: 'PAN-4399',
      state: 'working',
      attention: 'work-not-started',
      workStart: { status: 'not-started', at: '2026-09-29T10:00:00.000Z', error: 'spawn guardrails still refused the work agent' },
    });

    expect(screen.getByText('Work agent not started')).toBeInTheDocument();
    expect(screen.getByText('spawn guardrails still refused the work agent')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Start work' });
    expect(button).toBeEnabled();
  });

  it('falls back to the ordinary "Plan ready" label when there is no workStartError', () => {
    renderRow({ issueId: 'PAN-4399', state: 'planned' });

    expect(screen.getByText('Plan ready')).toBeInTheDocument();
    expect(screen.queryByText('Work agent not started')).toBeNull();
  });
});
