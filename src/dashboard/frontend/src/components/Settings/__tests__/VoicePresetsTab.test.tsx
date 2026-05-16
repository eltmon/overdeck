import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VoicePresetsTab } from '../VoicePresetsTab';
import { DEFAULT_VOICE_DESIGN_TEST_TEXT } from '../VoiceDesignTab';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VoicePresetsTab />
    </QueryClientProvider>,
  );
}

describe('VoicePresetsTab', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)) as unknown as typeof fetch;
    vi.spyOn(window, 'prompt').mockReturnValue('Saved Vivian');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders all nine Qwen3-TTS CustomVoice presets with play buttons and gender icons', () => {
    renderTab();

    for (const name of ['Aiden', 'Dylan', 'Eric', 'Ono Anna', 'Ryan', 'Serena', 'Sohee', 'Uncle Fu', 'Vivian']) {
      expect(screen.getByText(name)).toBeInTheDocument();
      expect(screen.getByTestId(`tts-preset-play-${name}`)).toBeInTheDocument();
    }
    expect(screen.getAllByLabelText('Male voice')).toHaveLength(5);
    expect(screen.getAllByLabelText('Female voice')).toHaveLength(4);
  });

  it('plays a preset with custom mode and the preview volume', async () => {
    const user = userEvent.setup();
    renderTab();

    fireEvent.change(screen.getByTestId('tts-presets-volume'), { target: { value: '0.35' } });
    await user.click(screen.getByTestId('tts-preset-play-Vivian'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: DEFAULT_VOICE_DESIGN_TEST_TEXT,
          voice: 'Vivian',
          mode: 'custom',
          volume: 0.35,
        }),
      });
    });
  });

  it('plays all presets in sequence', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByTestId('tts-presets-play-all'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(9));
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/tts/speak', expect.objectContaining({
      body: expect.stringContaining('Aiden'),
    }));
    expect(global.fetch).toHaveBeenNthCalledWith(9, '/api/tts/speak', expect.objectContaining({
      body: expect.stringContaining('Vivian'),
    }));
  });

  it('saves the selected preset as a saved preset voice', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByText('Vivian'));
    await user.click(screen.getByTestId('tts-preset-save-selected'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Saved Vivian',
          kind: 'preset',
          presetName: 'Vivian',
        }),
      });
    });
  });
});
