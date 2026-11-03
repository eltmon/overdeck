/** PAN-4475 WI-9: the viewer page's join hook — confirm, join intent, subscribe, signals, teardown. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { JoinEvent, JoinState, JoinView, SignalData } from '@overdeck/contracts';

import { JoinApiError, type JoinEventHandlers } from '../joinApi';
import { useSharedJoin, type JoinApi, type ViewerFactory, type ViewerPeer } from '../useSharedJoin';

const CODE = 'BCDFGHJK';
const OFFER: SignalData = { sdp: { type: 'offer', sdp: 'v=0 offer' } };

function view(state: JoinState): JoinView {
  return { shortCode: CODE, joinUrl: `https://share.overdeck.ai/s/${CODE}`, state, contributor: false, login: 'alice', closeCode: null, error: null };
}

interface Fakes {
  api: JoinApi;
  streams: { handlers: JoinEventHandlers; closed: boolean }[];
  viewers: (ViewerPeer & { signals: SignalData[]; closed: boolean })[];
  viewer: ViewerFactory;
  createJoin: ReturnType<typeof vi.fn>;
}

function fakes(initial: JoinView | null, create: () => Promise<JoinView> = async () => view('connecting')): Fakes {
  const streams: Fakes['streams'] = [];
  const viewers: Fakes['viewers'] = [];
  const createJoin = vi.fn(create);
  const api: JoinApi = {
    getJoin: vi.fn(async () => initial),
    createJoin,
    postSignal: vi.fn(async () => undefined),
    fetchJoinIceServers: vi.fn(async () => []),
    leaveJoin: vi.fn(async () => undefined),
    openJoinEvents: vi.fn((_code: string, handlers: JoinEventHandlers) => {
      const entry = { handlers, closed: false };
      streams.push(entry);
      return { close: () => { entry.closed = true; } };
    }),
  };
  const viewer: ViewerFactory = () => {
    const created = {
      signals: [] as SignalData[],
      closed: false,
      onSignal(data: SignalData) { created.signals.push(data); },
      close() { created.closed = true; },
    };
    viewers.push(created);
    return created;
  };
  return { api, streams, viewers, viewer, createJoin };
}

function emit(f: Fakes, event: JoinEvent): void {
  act(() => f.streams.at(-1)?.handlers.onEvent(event));
}

describe('useSharedJoin (PAN-4475 WI-9)', () => {
  it('shows confirm when no join exists', async () => {
    const f = fakes(null);
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('confirm'));
    expect(f.createJoin).not.toHaveBeenCalled();
    expect(f.streams).toHaveLength(0);
  });

  it('join() posts once, then opens the event stream', async () => {
    const f = fakes(null);
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('confirm'));
    act(() => result.current.join());
    await waitFor(() => expect(result.current.phase).toBe('live'));
    expect(f.createJoin).toHaveBeenCalledTimes(1);
    expect(f.createJoin).toHaveBeenCalledWith(CODE);
    expect(f.streams).toHaveLength(1);
  });

  it('subscribes to a live join on mount without posting', async () => {
    const f = fakes(view('lobby'));
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('live'));
    expect(f.createJoin).not.toHaveBeenCalled();
    expect(f.streams).toHaveLength(1);
    expect(result.current.view?.state).toBe('lobby');
  });

  it('resumes an away join by posting automatically', async () => {
    const f = fakes(view('away'));
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('live'));
    expect(f.createJoin).toHaveBeenCalledTimes(1);
  });

  it('creates one viewer on the first signal and forwards every signal to it', async () => {
    const f = fakes(view('admitted'));
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('live'));
    emit(f, { type: 'signal', data: OFFER });
    emit(f, { type: 'signal', data: { candidate: { candidate: 'c1' } } });
    expect(f.viewers).toHaveLength(1);
    expect(f.viewers[0]?.signals).toEqual([OFFER, { candidate: { candidate: 'c1' } }]);
  });

  it('a kicked state closes the viewer and the stream', async () => {
    const f = fakes(view('admitted'));
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('live'));
    emit(f, { type: 'signal', data: OFFER });
    emit(f, { type: 'state', view: view('kicked') });
    expect(result.current.view?.state).toBe('kicked');
    expect(f.viewers[0]?.closed).toBe(true);
    expect(f.streams[0]?.closed).toBe(true);
  });

  it('replaced moves to replaced-here and closes both', async () => {
    const f = fakes(view('admitted'));
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('live'));
    emit(f, { type: 'signal', data: OFFER });
    emit(f, { type: 'replaced' });
    expect(result.current.phase).toBe('replaced-here');
    expect(f.viewers[0]?.closed).toBe(true);
    expect(f.streams[0]?.closed).toBe(true);
  });

  it('a 412 from the join intent is an error with that status', async () => {
    const f = fakes(null, async () => { throw new JoinApiError(412, 'not_signed_in', 'Sign in'); });
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('confirm'));
    act(() => result.current.join());
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.apiError?.status).toBe(412);
  });

  it('a closed event stream is events_closed; a retrying one stays live', async () => {
    const f = fakes(view('lobby'));
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('live'));
    act(() => f.streams[0]?.handlers.onError(false));
    expect(result.current.phase).toBe('live');
    act(() => f.streams[0]?.handlers.onError(true));
    expect(result.current.phase).toBe('error');
    expect(result.current.apiError?.error).toBe('events_closed');
    expect(f.streams[0]?.closed).toBe(true);
  });

  it('leave() deletes the join, closes the stream and shows left', async () => {
    const f = fakes(view('lobby'));
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('live'));
    act(() => result.current.leave());
    await waitFor(() => expect(result.current.view?.state).toBe('left'));
    expect(f.api.leaveJoin).toHaveBeenCalledWith(CODE);
    expect(f.streams[0]?.closed).toBe(true);
  });

  it('reconnect() closes the viewer and the stream and opens a new stream', async () => {
    const f = fakes(view('admitted'));
    const { result } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('live'));
    emit(f, { type: 'signal', data: OFFER });
    act(() => result.current.reconnect());
    expect(f.viewers[0]?.closed).toBe(true);
    expect(f.streams[0]?.closed).toBe(true);
    expect(f.streams).toHaveLength(2);
    emit(f, { type: 'signal', data: OFFER });
    expect(f.viewers).toHaveLength(2);
  });

  it('unmount closes the viewer and the stream', async () => {
    const f = fakes(view('admitted'));
    const { result, unmount } = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(result.current.phase).toBe('live'));
    emit(f, { type: 'signal', data: OFFER });
    unmount();
    expect(f.viewers[0]?.closed).toBe(true);
    expect(f.streams[0]?.closed).toBe(true);
  });
});
