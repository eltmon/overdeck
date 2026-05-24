import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_METHODS } from '@panctl/contracts';

const wsTransportMock = vi.hoisted(() => ({
  request: vi.fn(),
  resolveFilePathExists: vi.fn(),
}));

vi.mock('../../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
}));

import { useFilePathExists } from '../useFilePathExists';
import { _resetFilePathExistsCacheForTests } from '../../lib/filePathExistsCache';

function wireMock() {
  wsTransportMock.request.mockImplementation((connect: (client: Record<string, unknown>) => unknown) =>
    connect({
      [WS_METHODS.resolveFilePathExists]: wsTransportMock.resolveFilePathExists,
    }),
  );
}

describe('useFilePathExists', () => {
  beforeEach(() => {
    _resetFilePathExistsCacheForTests();
    wsTransportMock.request.mockReset();
    wsTransportMock.resolveFilePathExists.mockReset();
    wireMock();
  });

  it('starts in loading state then resolves to exists', async () => {
    wsTransportMock.resolveFilePathExists.mockResolvedValue({ exists: true, kind: 'file' });
    const { result } = renderHook(() => useFilePathExists('/cwd', 'src/App.tsx'));

    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('exists'));
    expect(result.current).toEqual({ state: 'exists', kind: 'file' });
  });

  it('resolves to missing for phantom paths', async () => {
    wsTransportMock.resolveFilePathExists.mockResolvedValue({ exists: false, kind: null });
    const { result } = renderHook(() => useFilePathExists('/cwd', 'conv/2209'));

    await waitFor(() => expect(result.current.state).toBe('missing'));
  });

  it('returns missing immediately when cwd or path are missing — no RPC call', async () => {
    const { result: noCwd } = renderHook(() => useFilePathExists(undefined, 'src/App.tsx'));
    const { result: noPath } = renderHook(() => useFilePathExists('/cwd', undefined));
    expect(noCwd.current.state).toBe('missing');
    expect(noPath.current.state).toBe('missing');
    expect(wsTransportMock.resolveFilePathExists).not.toHaveBeenCalled();
  });

  it('reads from cache on second render — no second RPC call', async () => {
    wsTransportMock.resolveFilePathExists.mockResolvedValue({ exists: true, kind: 'dir' });
    const first = renderHook(() => useFilePathExists('/cwd', 'src/components/Foo'));
    await waitFor(() => expect(first.result.current.state).toBe('exists'));
    expect(wsTransportMock.resolveFilePathExists).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useFilePathExists('/cwd', 'src/components/Foo'));
    // Cached: should be 'exists' synchronously, no extra RPC.
    expect(second.result.current).toEqual({ state: 'exists', kind: 'dir' });
    expect(wsTransportMock.resolveFilePathExists).toHaveBeenCalledTimes(1);
  });

  it('deduplicates inflight requests for the same (cwd, path)', async () => {
    let resolveRpc: (value: { exists: boolean; kind: 'file' | null }) => void = () => undefined;
    wsTransportMock.resolveFilePathExists.mockReturnValue(
      new Promise((res) => {
        resolveRpc = res as typeof resolveRpc;
      }),
    );

    const a = renderHook(() => useFilePathExists('/cwd', 'shared/path.ts'));
    const b = renderHook(() => useFilePathExists('/cwd', 'shared/path.ts'));
    const c = renderHook(() => useFilePathExists('/cwd', 'shared/path.ts'));

    expect(a.result.current.state).toBe('loading');
    expect(b.result.current.state).toBe('loading');
    expect(c.result.current.state).toBe('loading');

    await act(async () => {
      resolveRpc({ exists: true, kind: 'file' });
    });

    await waitFor(() => expect(a.result.current.state).toBe('exists'));
    expect(b.result.current.state).toBe('exists');
    expect(c.result.current.state).toBe('exists');
    expect(wsTransportMock.resolveFilePathExists).toHaveBeenCalledTimes(1);
  });

  it('falls back to missing when the RPC throws', async () => {
    wsTransportMock.resolveFilePathExists.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useFilePathExists('/cwd', 'src/App.tsx'));
    await waitFor(() => expect(result.current.state).toBe('missing'));
  });
});
