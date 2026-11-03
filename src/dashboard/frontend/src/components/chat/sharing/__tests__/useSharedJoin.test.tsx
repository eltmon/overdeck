/** PAN-4475 WI-9: the viewer page's join hook — confirm, join intent, subscribe, signals, teardown. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JoinEvent, JoinState, JoinView, PresencePayload, SharedControllerCommand, SignalData } from '@overdeck/contracts';

import { JoinApiError, type JoinEventHandlers } from '../joinApi';
import {
  COMMAND_ACK_TIMEOUT_MS,
  DRAFT_SEND_MS,
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
  viewers: (ViewerPeer & {
    signals: SignalData[];
    closed: boolean;
    drafts: string[];
    submits: Array<[string, string]>;
    submitOpen: boolean;
    /** Controller commands and sends, in order (PAN-4478). */
    controls: Array<{ clientId: string; command?: SharedControllerCommand; text?: string; draftGithubId?: number }>;
    callbacks: WebRtcViewerCallbacks;
  })[];
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
      drafts: [] as string[],
      submits: [] as Array<[string, string]>,
      callbacks,
      onSignal(data: SignalData) { created.signals.push(data); },
      close() { created.closed = true; },
      sendDraft(text: string) { created.drafts.push(text); return true; },
      submitOpen: true,
      submit(clientId: string, text: string) {
        if (!created.submitOpen) return false;
        created.submits.push([clientId, text]);
        return true;
      },
      controls: [] as Fakes['viewers'][number]['controls'],
      command(clientId: string, command: SharedControllerCommand) {
        if (!created.submitOpen) return false;
        created.controls.push({ clientId, command });
        return true;
      },
      controllerSend(clientId: string, text: string, draftGithubId?: number) {
        if (!created.submitOpen) return false;
        created.controls.push(draftGithubId === undefined ? { clientId, text } : { clientId, text, draftGithubId });
        return true;
      },
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

describe('useSharedJoin drafts and prompts (PAN-4476 WI-13)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function live(contributor = false) {
    const f = fakes({ ...view('admitted'), contributor });
    const hook = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(hook.result.current.phase).toBe('live'));
    emit(f, { type: 'signal', data: OFFER });
    const peer = f.viewers.at(-1);
    if (!peer) throw new Error('no viewer');
    return { f, peer, result: hook.result };
  }

  it('sends one draft with the last text 150 ms after three quick keystrokes', async () => {
    const { peer, result } = await live();
    vi.useFakeTimers();
    act(() => result.current.setMyDraft('a'));
    act(() => { vi.advanceTimersByTime(50); });
    act(() => result.current.setMyDraft('ab'));
    act(() => { vi.advanceTimersByTime(50); });
    act(() => result.current.setMyDraft('abc'));
    expect(peer.drafts).toEqual([]);
    act(() => { vi.advanceTimersByTime(DRAFT_SEND_MS - 100); });
    expect(peer.drafts).toEqual(['abc']);
    expect(result.current.myDraft).toBe('abc');
  });

  it('keeps one draft per author and removes it on an empty text', async () => {
    const { peer, result } = await live();
    act(() => peer.callbacks.onDraft?.({ authorGithubId: 8, authorLogin: 'bob', text: 'one', updatedAt: 1 }));
    act(() => peer.callbacks.onDraft?.({ authorGithubId: 9, authorLogin: 'carol', text: 'two', updatedAt: 1 }));
    act(() => peer.callbacks.onDraft?.({ authorGithubId: 8, authorLogin: 'bob', text: 'one more', updatedAt: 2 }));
    expect(result.current.drafts.map((d) => d.text)).toEqual(['one more', 'two']);
    act(() => peer.callbacks.onDraft?.({ authorGithubId: 8, authorLogin: 'bob', text: '', updatedAt: 3 }));
    expect(result.current.drafts.map((d) => d.authorLogin)).toEqual(['carol']);
  });

  it('submitPrompt sends the draft with a UUID client id, clears it and sends an empty draft', async () => {
    const { peer, result } = await live(true);
    act(() => result.current.setMyDraft('Run the tests'));
    act(() => result.current.submitPrompt());
    expect(peer.submits).toHaveLength(1);
    expect(peer.submits[0]?.[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(peer.submits[0]?.[1]).toBe('Run the tests');
    expect(result.current.myDraft).toBe('');
    expect(peer.drafts).toEqual(['']);
  });

  it('submitPrompt does nothing for a non-contributor or a refused prompt', async () => {
    const viewerOnly = await live(false);
    vi.useFakeTimers();
    act(() => viewerOnly.result.current.setMyDraft('Run the tests'));
    act(() => viewerOnly.result.current.submitPrompt());
    expect(viewerOnly.peer.submits).toEqual([]);
    vi.useRealTimers();
    const contributor = await live(true);
    vi.useFakeTimers();
    act(() => contributor.result.current.setMyDraft('/clear'));
    act(() => contributor.result.current.submitPrompt());
    expect(contributor.peer.submits).toEqual([]);
  });

  it('records the latest submit ack and the draft-sent notice', async () => {
    const { peer, result } = await live();
    act(() => result.current.setMyDraft('my idea'));
    act(() => peer.callbacks.onSubmitAck?.({ clientId: 'c1', status: 'queued', position: 2 }));
    expect(result.current.submitStatus).toEqual({ clientId: 'c1', status: 'queued', position: 2 });
    act(() => peer.callbacks.onDraftSent?.());
    expect(result.current.draftSentNotice).toBe(true);
    expect(result.current.myDraft).toBe('');
    // An empty snapshot clears any draft a late trailing send recreated on the host.
    expect(peer.drafts.at(-1)).toBe('');
  });

  it('keeps the text and reports a rejected status when the channel cannot send the submit', async () => {
    const { peer, result } = await live(true);
    vi.useFakeTimers();
    peer.submitOpen = false;
    act(() => result.current.setMyDraft('Run the tests'));
    act(() => result.current.submitPrompt());
    expect(result.current.myDraft).toBe('Run the tests');
    expect(result.current.submitStatus).toMatchObject({ status: 'rejected' });
    expect(result.current.submitStatus?.reason).toBeUndefined();
  });

  it('re-sends the current draft on ready and keeps it across a reconnect', async () => {
    const { f, peer, result } = await live();
    vi.useFakeTimers();
    act(() => result.current.setMyDraft('half typed'));
    act(() => peer.callbacks.onReady?.());
    expect(peer.drafts.at(-1)).toBe('half typed');
    act(() => result.current.reconnect());
    expect(result.current.myDraft).toBe('half typed');
    emit(f, { type: 'signal', data: OFFER });
    const next = f.viewers.at(-1);
    act(() => next?.callbacks.onReady?.());
    expect(next?.drafts).toEqual(['half typed']);
  });
});

describe('useSharedJoin controller commands (PAN-4478 WI-6)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function live() {
    const f = fakes(view('admitted'));
    const hook = renderHook(() => useSharedJoin(CODE, { api: f.api, viewer: f.viewer }));
    await waitFor(() => expect(hook.result.current.phase).toBe('live'));
    emit(f, { type: 'signal', data: OFFER });
    const peer = f.viewers.at(-1);
    if (!peer) throw new Error('no viewer');
    return { f, peer, result: hook.result };
  }

  const presence = (controllerGithubId: number): PresencePayload => ({ controllerGithubId, participants: [], streams: [] });

  it('isController follows identity and presence', async () => {
    const { peer, result } = await live();
    expect(result.current.selfGithubId).toBeNull();
    act(() => peer.callbacks.onPresence(presence(100)));
    expect(result.current.isController).toBe(false);
    act(() => peer.callbacks.onIdentity?.(100));
    expect(result.current.selfGithubId).toBe(100);
    expect(result.current.isController).toBe(true);
    act(() => peer.callbacks.onPresence(presence(1)));
    expect(result.current.isController).toBe(false);
  });

  it('sendCommand resolves on accepted and rejects with the refusal text', async () => {
    const { peer, result } = await live();
    let accepted: Promise<void> | undefined;
    act(() => { accepted = result.current.sendCommand({ type: 'admit', githubId: 200 }); });
    const first = peer.controls[0];
    expect(first?.command).toEqual({ type: 'admit', githubId: 200 });
    act(() => peer.callbacks.onCommandAck?.({ clientId: first?.clientId ?? '', status: 'accepted' }));
    await expect(accepted).resolves.toBeUndefined();

    let rejected: Promise<void> | undefined;
    act(() => { rejected = result.current.sendCommand({ type: 'kick', githubId: 200 }); });
    act(() => peer.callbacks.onCommandAck?.({ clientId: peer.controls[1]?.clientId ?? '', status: 'rejected', reason: 'not_controller' }));
    await expect(rejected).rejects.toThrow('You no longer have control.');

    let queued: Promise<number> | undefined;
    act(() => { queued = result.current.sendControllerPrompt('Run it', 300); });
    expect(peer.controls[2]).toMatchObject({ text: 'Run it', draftGithubId: 300 });
    act(() => peer.callbacks.onCommandAck?.({ clientId: peer.controls[2]?.clientId ?? '', status: 'accepted', position: 2 }));
    await expect(queued).resolves.toBe(2);
  });

  it('rejects at once when the peer cannot send', async () => {
    const { peer, result } = await live();
    peer.submitOpen = false;
    await expect(result.current.sendCommand({ type: 'kick', githubId: 200 })).rejects.toThrow('Not connected to the host.');
  });

  it('a command with no ack rejects after 10 s', async () => {
    const { result } = await live();
    vi.useFakeTimers();
    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.sendCommand({ type: 'kick', githubId: 200 }); });
    const settled = pending?.catch((error: Error) => error.message);
    await act(async () => { await vi.advanceTimersByTimeAsync(COMMAND_ACK_TIMEOUT_MS - 1); });
    let done = false;
    void settled?.then(() => { done = true; });
    await act(async () => { await Promise.resolve(); });
    expect(done).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await expect(settled).resolves.toBe('The host did not answer.');
  });

  it('a reconnect rejects pending commands', async () => {
    const { peer, result } = await live();
    act(() => peer.callbacks.onIdentity?.(100));
    let pending: Promise<number> | undefined;
    act(() => { pending = result.current.sendControllerPrompt('Run it'); });
    const settled = pending?.catch((error: Error) => error.message);
    act(() => result.current.reconnect());
    await expect(settled).resolves.toBe('Connection to the host was lost.');
    expect(result.current.selfGithubId).toBeNull();
  });
});
