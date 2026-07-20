/**
 * PAN-2908 · C-SIMPLE — TalkItThrough + just-filed surface tests.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    reviewStatusByIssueId: {},
  } as never);
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DialogProvider>{ui}</DialogProvider></QueryClientProvider>);
}

describe('TalkItThrough flow (C-SIMPLE)', () => {
  beforeEach(() => {
    useUiMode.setState({ mode: 'simple', simpleIssueId: null });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/conversations' && init?.method === 'POST') {
        return Response.json({ id: 42, name: 'conv-test-42' });
      }
      if (url === '/api/settings/available-models') return Response.json({});
      if (url === '/api/settings/openrouter/models') return Response.json({ models: [], favorites: [] });
      if (url === '/api/settings') return Response.json({ models: { default_conversation_model: 'claude-opus-4-6' } });
      return Response.json({});
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('seeds the conversation with a discuss-first, file-only-when-told prompt', () => {
    const prompt = seedDiscussPrompt('add dark mode to the mobile app');
    expect(prompt).toContain('do not file anything yet');
    expect(prompt).toContain('add dark mode to the mobile app');
    expect(prompt).toContain('file it as an issue');
  });

  it('posts the description to /api/conversations and navigates to the conversation', async () => {
    seed([]);
    renderWithProviders(<SimpleHomePage />);
    const input = screen.getByTestId('talk-it-through-input');
    fireEvent.change(input, { target: { value: 'sync our themes with the design system' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === '/api/conversations');
      expect(calls.length).toBeGreaterThan(0);
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/conversations')![1]!.body));
    expect(body.message).toContain('sync our themes with the design system');
    expect(body.message).toContain('do not file anything yet');
    expect(window.location.pathname).toBe('/conv/conv-test-42');
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
