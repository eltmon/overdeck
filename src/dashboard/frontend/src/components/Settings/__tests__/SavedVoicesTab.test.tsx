import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DialogProvider } from '../../DialogProvider';
import { SavedVoicesTab } from '../SavedVoicesTab';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>
        <SavedVoicesTab />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

describe('SavedVoicesTab', () => {
  beforeEach(() => {
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/tts/voices' && init?.method !== 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 'voice-preset', name: 'Preset Voice', kind: 'preset', presetName: 'vivian' },
            { id: 'voice-design', name: 'Design Voice', kind: 'design', description: 'warm narrator' },
          ]),
        } as Response);
      }
      if (url === '/api/tts/voices' && init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: 2 }) } as Response);
      }
      if (url === '/api/tts/voices/voice-preset' || url === '/api/tts/voices/voice-design') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: true }) } as Response);
      }
      if (url === '/api/tts/speak') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ spoken: true }) } as Response);
      }
      return Promise.resolve({ ok: false, text: () => Promise.resolve('not found') } as Response);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders saved voices with kind badges and play/delete actions', async () => {
    renderTab();

    expect(await screen.findByText('Preset Voice')).toBeInTheDocument();
    expect(screen.getByText('Design Voice')).toBeInTheDocument();
    expect(screen.getByText('Preset')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByTestId('tts-voice-play-voice-preset')).toBeInTheDocument();
    expect(screen.getByTestId('tts-voice-delete-voice-preset')).toBeInTheDocument();
  });

  it('deletes a saved voice through DELETE /api/tts/voices/:id', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByTestId('tts-voice-delete-voice-preset'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/voices/voice-preset', { method: 'DELETE' });
    });
  });

  it('plays saved voices as explicit previews and requires spoken responses', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByTestId('tts-voice-play-voice-preset'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: 'voice-preset', text: 'This is a Panopticon TTS voice test.', preview: true }),
      });
    });
  });

  it('reports non-spoken saved voice preview responses as errors', async () => {
    global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/tts/voices' && init?.method !== 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'voice-preset', name: 'Preset Voice', kind: 'preset', presetName: 'vivian' }]),
        } as Response);
      }
      if (url === '/api/tts/speak') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ spoken: false, result: 'muted' }) } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'not found' }) } as Response);
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByTestId('tts-voice-play-voice-preset'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to play voice: TTS did not speak (muted)'));
  });

  it('confirms before clearing all saved voices in one request', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByText('Clear All Saved'));
    expect(await screen.findByText('Clear saved voices?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear All' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/voices', { method: 'DELETE' });
    });
    expect(global.fetch).not.toHaveBeenCalledWith('/api/tts/voices/voice-preset', { method: 'DELETE' });
    expect(global.fetch).not.toHaveBeenCalledWith('/api/tts/voices/voice-design', { method: 'DELETE' });
  });
});
