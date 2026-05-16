import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TtsSystemVoicePicker } from '../TtsSystemVoicePicker';
import type { TtsVoiceListItem } from '../SavedVoicesTab';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const VOICES: TtsVoiceListItem[] = [
  { id: 'voice-preset', name: 'Preset Voice', kind: 'preset', presetName: 'Vivian' },
  { id: 'voice-design', name: 'Design Voice', kind: 'design', description: 'warm narrator' },
  { id: 'voice-clone', name: 'Clone Voice', kind: 'clone', instruct: 'steady delivery' },
];

function renderPicker(props?: Partial<React.ComponentProps<typeof TtsSystemVoicePicker>>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TtsSystemVoicePicker
        voices={VOICES}
        isLoading={false}
        systemVoiceId="voice-preset"
        statusVoiceId="voice-design"
        onSetSystemVoice={vi.fn()}
        onSetStatusVoice={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('TtsSystemVoicePicker', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ spoken: true }) } as Response)) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders saved voices with kind badges and selected system/status states', () => {
    renderPicker();

    expect(screen.getAllByText('Preset Voice')).toHaveLength(2);
    expect(screen.getAllByText('Design Voice')).toHaveLength(2);
    expect(screen.getAllByText('Clone Voice')).toHaveLength(2);
    expect(screen.getAllByText('Preset')).toHaveLength(2);
    expect(screen.getAllByText('Design')).toHaveLength(2);
    expect(screen.getAllByText('Clone')).toHaveLength(2);
    expect(screen.getByTestId('tts-system-voice-set-voice-preset')).toHaveTextContent('Selected');
    expect(screen.getByTestId('tts-status-voice-set-voice-design')).toHaveTextContent('Selected');
  });

  it('plays a saved voice through POST /api/tts/speak with test text', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByTestId('tts-system-voice-play-voice-design'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: 'voice-design',
          text: 'This is the current Panopticon system voice.',
        }),
      });
    });
  });

  it('calls the correct setter for system and status voice selection', async () => {
    const user = userEvent.setup();
    const onSetSystemVoice = vi.fn();
    const onSetStatusVoice = vi.fn();
    renderPicker({ onSetSystemVoice, onSetStatusVoice });

    await user.click(screen.getByTestId('tts-system-voice-set-voice-clone'));
    await user.click(screen.getByTestId('tts-status-voice-set-voice-clone'));

    expect(onSetSystemVoice).toHaveBeenCalledWith('voice-clone');
    expect(onSetStatusVoice).toHaveBeenCalledWith('voice-clone');
  });

  it('shows the empty-library message', () => {
    renderPicker({ voices: [] });

    expect(screen.getByText('No voices saved yet — add voices in the Voice Library below')).toBeInTheDocument();
  });
});
