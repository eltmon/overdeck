import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useVoiceTranscription } from '../useVoiceTranscription';
import { ensureDashboardSession } from '../../lib/wsTransport';

vi.mock('../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn(),
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  url: string;
  binaryType = 'blob';
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

describe('useVoiceTranscription — session mint (PAN-1166 W10)', () => {
  const getUserMedia = vi.fn();

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.mocked(ensureDashboardSession).mockReset();
    getUserMedia.mockReset();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never prompts for the microphone or opens a socket when the mint is refused', async () => {
    vi.mocked(ensureDashboardSession).mockRejectedValue(new Error('refused'));

    const { result } = renderHook(() => useVoiceTranscription());
    await act(async () => {
      await result.current.start();
    });

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.current.error).toBeTruthy();
  });

  it('opens the voice socket once the mint resolves', async () => {
    vi.mocked(ensureDashboardSession).mockResolvedValue(undefined);
    const track = { stop: vi.fn() };
    getUserMedia.mockResolvedValue({ getTracks: () => [track] });
    vi.stubGlobal(
      'AudioContext',
      class {
        destination = {};
        createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
        createAnalyser = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
        createScriptProcessor = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }));
        close = vi.fn().mockResolvedValue(undefined);
      },
    );

    const { result } = renderHook(() => useVoiceTranscription());
    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    expect(MockWebSocket.instances[0].url).toMatch(/\/ws\/voice$/);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
