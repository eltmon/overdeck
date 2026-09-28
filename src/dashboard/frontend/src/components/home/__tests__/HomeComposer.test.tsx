import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeComposer } from '../HomeComposer';
import { applyDefaultConversationModel } from '../../chat/defaultConversationModel';
import { takePendingTerminal } from '../pendingTerminal';

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const assignMock = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  assignMock.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignMock },
  });
  applyDefaultConversationModel('claude-opus-4-6');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/registered-projects') return Response.json([]);
    if (url === '/api/prerequisites') return Response.json({ platform: 'linux', allRequiredFound: true, checks: [] });
    if (url === '/api/settings/available-models') return Response.json({});
    if (url === '/api/settings/openrouter/models') return Response.json({ models: [], favorites: [] });
    if (url === '/api/settings') return Response.json({ models: { default_conversation_model: 'claude-opus-4-6' } });
    if (url === '/api/issues/resource-allocated') return Response.json([]);
    if (url === '/api/conversations' && init?.method === 'POST') return Response.json({ name: 'conv-e2e' });
    return Response.json({});
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HomeComposer', () => {
  it('Enter posts the raw message with no projectKey when no projects exist', async () => {
    renderWithProviders(<HomeComposer mode="advanced" />);
    const input = screen.getByTestId('home-composer-input');
    fireEvent.change(input, { target: { value: 'hello there' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/conv/conv-e2e'));
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/conversations')!;
    const body = JSON.parse(String(call[1]!.body));
    expect(body.message).toBe('hello there');
    expect(body.projectKey).toBeUndefined();
  });

  it('the talk row posts the seeded prompt', async () => {
    renderWithProviders(<HomeComposer mode="simple" />);
    const input = screen.getByTestId('home-composer-input');
    fireEvent.change(input, { target: { value: 'add dark mode' } });
    const talkRow = await screen.findByText('Talk it through first:');
    fireEvent.mouseDown(talkRow);

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/conv/conv-e2e'));
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/conversations')!;
    const body = JSON.parse(String(call[1]!.body));
    expect(body.message).toContain('do not file anything yet');
    expect(body.message).toContain('add dark mode');
  });

  it('a server error shows and the typed text stays', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/conversations' && init?.method === 'POST') {
        return Response.json({ error: 'Conversation service unavailable' }, { status: 503 });
      }
      if (url === '/api/registered-projects') return Response.json([]);
      if (url === '/api/prerequisites') return Response.json({ platform: 'linux', allRequiredFound: true, checks: [] });
      if (url === '/api/settings/available-models') return Response.json({});
      if (url === '/api/settings/openrouter/models') return Response.json({ models: [], favorites: [] });
      if (url === '/api/settings') return Response.json({ models: { default_conversation_model: 'claude-opus-4-6' } });
      if (url === '/api/issues/resource-allocated') return Response.json([]);
      return Response.json({});
    });
    renderWithProviders(<HomeComposer mode="advanced" />);
    const input = screen.getByTestId('home-composer-input');
    fireEvent.change(input, { target: { value: 'keep this text' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Conversation service unavailable');
    expect(input).toHaveValue('keep this text');
  });

  it('Ctrl+Enter writes the hand-off and opens the no-project deck', async () => {
    renderWithProviders(<HomeComposer mode="advanced" />);
    const input = screen.getByTestId('home-composer-input');
    fireEvent.change(input, { target: { value: 'npm run dev' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    expect(takePendingTerminal('__no-project__')).toBe('npm run dev');
    expect(assignMock).toHaveBeenCalledWith('/command-deck/__no-project__');
  });
});
