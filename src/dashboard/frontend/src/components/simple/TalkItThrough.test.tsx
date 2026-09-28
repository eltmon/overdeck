/**
 * PAN-2908 · C-SIMPLE — seedDiscussPrompt + just-filed surface tests.
 *
 * The composer itself (PAN-4280, D8) moved to HomeComposer; its behavior is
 * covered by components/home/__tests__/HomeComposer.test.tsx. This file keeps
 * seedDiscussPrompt's pure-function contract and the "Just filed" surface,
 * which belongs to SimpleHomePage, not the composer.
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';
import { DialogProvider } from '../DialogProvider';
import { SimpleHomePage } from './SimpleHomePage';
import { seedDiscussPrompt } from './TalkItThrough';
import { useDashboardStore } from '../../lib/store';
import { useUiMode } from '../../lib/simple/uiMode';
import type { Issue } from '../../types';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: overrides.identifier ?? 'PAN-1',
    identifier: 'PAN-1',
    title: 'A freshly filed idea',
    status: 'Todo',
    priority: 2,
    labels: [],
    url: 'https://github.com/eltmon/overdeck/issues/1',
    state: 'todo',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Issue;
}

function seed(issues: Issue[]) {
  useDashboardStore.setState({
    ...INITIAL_READ_MODEL_STATE,
    issuesRaw: issues,
    agentsById: {},
    derivedIssueStateByIssueId: {},
    backendPanesById: {},
  } as never);
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DialogProvider>{ui}</DialogProvider></QueryClientProvider>);
}

describe('seedDiscussPrompt', () => {
  it('seeds the conversation with a discuss-first, file-only-when-told prompt', () => {
    const prompt = seedDiscussPrompt('add dark mode to the mobile app');
    expect(prompt).toContain('do not file anything yet');
    expect(prompt).toContain('add dark mode to the mobile app');
    expect(prompt).toContain('file it as an issue');
  });
});

describe('Just filed (C-SIMPLE)', () => {
  beforeEach(() => {
    useUiMode.setState({ mode: 'simple', simpleIssueId: null });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/settings/available-models') return Response.json({});
      if (url === '/api/settings/openrouter/models') return Response.json({ models: [], favorites: [] });
      if (url === '/api/settings') return Response.json({ models: { default_conversation_model: 'claude-opus-4-6' } });
      if (url === '/api/issues/resource-allocated') return Response.json([]);
      if (url === '/api/registered-projects') return Response.json([]);
      if (url === '/api/prerequisites') return Response.json({ platform: 'linux', allRequiredFound: true, checks: [] });
      return Response.json({});
    }));
  });

  it('shows just-filed issues with Start planning, and hides old ones', () => {
    seed([
      makeIssue({ identifier: 'PAN-9', title: 'Filed ten minutes ago', createdAt: new Date(Date.now() - 10 * 60_000).toISOString() }),
      makeIssue({ identifier: 'PAN-10', title: 'Filed last week', createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString() }),
    ]);
    renderWithProviders(<SimpleHomePage />);
    expect(screen.getByText('Just filed')).toBeInTheDocument();
    expect(screen.getByText('Filed ten minutes ago')).toBeInTheDocument();
    expect(screen.queryByText('Filed last week')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start planning' })).toBeInTheDocument();
  });
});
