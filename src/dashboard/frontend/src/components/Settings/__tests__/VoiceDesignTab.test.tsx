import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VoiceDesignTab } from '../VoiceDesignTab';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VoiceDesignTab />
    </QueryClientProvider>,
  );
}

describe('VoiceDesignTab', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)) as unknown as typeof fetch;
    vi.spyOn(window, 'prompt').mockReturnValue('Calm Design Voice');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('previews a design voice through POST /api/tts/speak', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.clear(screen.getByTestId('tts-design-description'));
    await user.type(screen.getByTestId('tts-design-description'), 'warm synthetic narrator');
    await user.clear(screen.getByTestId('tts-design-instruct'));
    await user.type(screen.getByTestId('tts-design-instruct'), 'calm and crisp');
    await user.clear(screen.getByTestId('tts-design-test-text'));
    await user.type(screen.getByTestId('tts-design-test-text'), 'PAN-829 is ready');
    await user.click(screen.getByTestId('tts-design-preview'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'PAN-829 is ready',
          voice: 'warm synthetic narrator',
          instruct: 'calm and crisp',
          mode: 'design',
        }),
      });
    });
  });

  it('saves a design voice without embedding fields', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.clear(screen.getByTestId('tts-design-description'));
    await user.type(screen.getByTestId('tts-design-description'), 'measured dashboard voice');
    await user.clear(screen.getByTestId('tts-design-instruct'));
    await user.type(screen.getByTestId('tts-design-instruct'), 'steady delivery');
    await user.click(screen.getByTestId('tts-design-save'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Calm Design Voice',
          kind: 'design',
          description: 'measured dashboard voice',
          instruct: 'steady delivery',
        }),
      });
    });
  });

  it('extracts an embedding and saves a cloned voice', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt').mockReturnValue('Exact Voice Clone');
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/tts/extract-embedding') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }) } as Response);
      }
      if (url === '/api/tts/voices') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'clone-voice' }) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    }) as unknown as typeof fetch;
    renderTab();

    await user.clear(screen.getByTestId('tts-design-description'));
    await user.type(screen.getByTestId('tts-design-description'), 'byte stable dashboard voice');
    await user.clear(screen.getByTestId('tts-design-instruct'));
    await user.type(screen.getByTestId('tts-design-instruct'), 'steady delivery');
    await user.clear(screen.getByTestId('tts-design-test-text'));
    await user.type(screen.getByTestId('tts-design-test-text'), 'sample text for embedding');
    await user.click(screen.getByTestId('tts-design-clone'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/extract-embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          design: 'byte stable dashboard voice',
          text: 'sample text for embedding',
        }),
      });
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Exact Voice Clone',
          kind: 'clone',
          description: 'byte stable dashboard voice',
          instruct: 'steady delivery',
          embedding: [0.1, 0.2, 0.3],
        }),
      });
    });
  });

  it('shows extraction loading state while cloning', async () => {
    const user = userEvent.setup();
    let resolveEmbedding: (value: Response) => void = () => undefined;
    global.fetch = vi.fn((input: string | URL | Request) => {
      const url = input.toString();
      if (url === '/api/tts/extract-embedding') {
        return new Promise<Response>((resolve) => { resolveEmbedding = resolve; });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'clone-voice' }) } as Response);
    }) as unknown as typeof fetch;
    renderTab();

    await user.click(screen.getByTestId('tts-design-clone'));
    expect(screen.getByTestId('tts-design-clone-loading')).toHaveTextContent('Extracting speaker embedding... this takes ~30s');
    expect(screen.getByTestId('tts-design-clone')).toBeDisabled();

    resolveEmbedding({ ok: true, json: () => Promise.resolve({ embedding: [0.5] }) } as Response);
    await waitFor(() => expect(screen.queryByTestId('tts-design-clone-loading')).toBeNull());
  });
});
