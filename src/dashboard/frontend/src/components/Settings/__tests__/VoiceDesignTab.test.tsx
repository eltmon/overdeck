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
});
