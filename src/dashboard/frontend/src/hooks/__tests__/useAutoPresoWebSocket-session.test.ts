import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAutoPresoWebSocket } from '../useAutoPresoWebSocket';
import { ensureDashboardSession } from '../../lib/wsTransport';

vi.mock('../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn(),
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

describe('useAutoPresoWebSocket — session mint (PAN-1166 W9)', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.mocked(ensureDashboardSession).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never opens the whiteboard socket when the mint is refused', async () => {
    vi.mocked(ensureDashboardSession).mockRejectedValue(new Error('refused'));

    const { unmount } = renderHook(() => useAutoPresoWebSocket());

    await waitFor(() => {
      expect(ensureDashboardSession).toHaveBeenCalled();
    });
    expect(MockWebSocket.instances).toHaveLength(0);
    unmount();
  });

  it('opens the whiteboard socket once the mint resolves', async () => {
    vi.mocked(ensureDashboardSession).mockResolvedValue(undefined);

    const { unmount } = renderHook(() => useAutoPresoWebSocket());

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(1);
    });
    expect(MockWebSocket.instances[0].url).toMatch(/\/ws\/autopreso$/);
    unmount();
  });
});
