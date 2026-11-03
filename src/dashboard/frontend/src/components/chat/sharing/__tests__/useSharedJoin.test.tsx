/** PAN-4475 WI-9: the viewer page's join hook — confirm, join intent, subscribe, signals, teardown. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JoinEvent, JoinState, JoinView, SharedMessage, SignalData } from '@overdeck/contracts';

import { JoinApiError, type JoinEventHandlers } from '../joinApi';
import {
  PEER_AUTO_RECONNECT_DELAY_MS,
  PEER_AUTO_RECONNECT_MAX,
  useSharedJoin,
  type JoinApi,
  type ViewerFactory,
  type ViewerPeer,
} from '../useSharedJoin';
import type { WebRtcViewerCallbacks } from '../webrtc-viewer';

const CODE = 'BCDFGHJK';
const OFFER: SignalData = { sdp: { type: 'offer', sdp: 'v=0 offer' } };

function view(state: JoinState): JoinView {
  return { shortCode: CODE, joinUrl: `https://share.overdeck.ai/s/${CODE}`, state, contributor: false, login: 'alice', closeCode: null, error: null };
}

interface Fakes {
  api: JoinApi;
  streams: { handlers: JoinEventHandlers; closed: boolean }[];
  viewers: (ViewerPeer & { signals: SignalData[]; closed: boolean; callbacks: WebRtcViewerCallbacks })[];
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
  const viewer: ViewerFactory = (_deps, callbacks) => {
    const created = {
      signals: [] as SignalData[],
      closed: false,
      callbacks,
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

const MESSAGES: SharedMessage[] = [
  { id: 'm1', role: 'user', text: 'Please fix the flaky test', createdAt: '2026-11-03T00:00:00.000Z' },
];

describe('useSharedJoin peer auto-reconnect (PAN-4479 D-8)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Mounts on a join in `state`, receives an offer and history, then the peer is lost. */
  async function lostPeer(state: JoinState) {
    const f = fakes(view(state));
    const hook = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await act(async () => {});
    expect(hook.result.current.phase).toBe('live');
    emit(f, { type: 'signal', data: OFFER });
    const peer = f.viewers.at(-1)!;
    act(() => peer.callbacks.onMessages(MESSAGES));
    act(() => peer.callbacks.onPhase('lost'));
    return { f, hook, peer };
  }

  /** Advances in 1 s steps, each in its own act(), so effects re-arm between timers as in a browser. */
  async function advance(ms: number): Promise<void> {
    for (let left = ms; left > 0; left -= 1_000) {
      const step = Math.min(left, 1_000);
      await act(async () => { await vi.advanceTimersByTimeAsync(step); });
    }
  }

  it('a lost peer while admitted opens a new event stream after 5 s and keeps the messages', async () => {
    const { f, hook } = await lostPeer('admitted');
    await advance(PEER_AUTO_RECONNECT_DELAY_MS - 1);
    expect(f.api.openJoinEvents).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(f.api.openJoinEvents).toHaveBeenCalledTimes(2);
    expect(f.streams[0]?.closed).toBe(true);
    expect(hook.result.current.messages).toEqual(MESSAGES);
    expect(hook.result.current.hasHistory).toBe(true);
  });

  it('stops after 3 automatic tries and leaves the Reconnect banner', async () => {
    const { f, hook } = await lostPeer('admitted');
    await advance(60_000);
    expect(f.api.openJoinEvents).toHaveBeenCalledTimes(1 + PEER_AUTO_RECONNECT_MAX);
    expect(hook.result.current.peerPhase).toBe('lost');
    await advance(60_000);
    expect(f.api.openJoinEvents).toHaveBeenCalledTimes(4);
  });

  it('a connected peer resets the count', async () => {
    const { f } = await lostPeer('admitted');
    await advance(PEER_AUTO_RECONNECT_DELAY_MS);
    expect(f.api.openJoinEvents).toHaveBeenCalledTimes(2);
    emit(f, { type: 'signal', data: OFFER });
    const next = f.viewers.at(-1)!;
    expect(f.viewers).toHaveLength(2);
    act(() => next.callbacks.onPhase('connected'));
    act(() => next.callbacks.onPhase('lost'));
    await advance(60_000);
    expect(f.api.openJoinEvents).toHaveBeenCalledTimes(2 + PEER_AUTO_RECONNECT_MAX);
  });

  it('no automatic try while host-disconnected or reconnecting', async () => {
    for (const state of ['host-disconnected', 'reconnecting'] as const) {
      const { f, hook } = await lostPeer(state);
      await advance(60_000);
      expect(f.api.openJoinEvents).toHaveBeenCalledTimes(1);
      hook.unmount();
    }
  });

  it('a new offer before 5 s cancels the try', async () => {
    const { f, peer } = await lostPeer('admitted');
    await advance(PEER_AUTO_RECONNECT_DELAY_MS - 1_000);
    act(() => peer.callbacks.onPhase('connecting'));
    await advance(60_000);
    expect(f.api.openJoinEvents).toHaveBeenCalledTimes(1);
  });
});
