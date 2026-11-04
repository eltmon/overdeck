import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveActivityCounts, MachineToDirectoryFrame } from '@overdeck/contracts';
import {
  createLiveActivitySender,
  LIVE_ACTIVITY_KEEPALIVE_MS,
  LIVE_ACTIVITY_MIN_INTERVAL_MS,
  LIVE_ACTIVITY_POLL_MS,
} from '../live-activity-sender.js';

const A = '00000000-0000-4000-9000-00000000000a';
const B = '00000000-0000-4000-9000-00000000000b';
const C = '00000000-0000-4000-9000-00000000000c';

function harness(initial: LiveActivityCounts = { needsYou: 1, running: 2 }) {
  const state = { counts: initial, phones: [A, B], online: true, accept: true };
  const sent: MachineToDirectoryFrame[] = [];
  const counts = vi.fn(async () => state.counts);
  const sender = createLiveActivitySender({
    counts,
    phones: () => state.phones,
    directory: () => ({
      isOnline: () => state.online,
      send: (frame) => {
        if (state.accept) sent.push(frame);
        return state.accept;
      },
    }),
    now: () => Date.now(),
  });
  return { state, sent, counts, sender };
}

const tos = (frames: MachineToDirectoryFrame[]) => frames.map((f) => (f.type === 'push-activity' ? f.to : f.type));

describe('createLiveActivitySender (PAN-4839 WI-5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends to every phone on the first online tick, with exactly type, to, needsYou and running', async () => {
    const { sent, sender } = harness();
    sender.start();
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    expect(sent).toEqual([
      { type: 'push-activity', to: A, needsYou: 1, running: 2 },
      { type: 'push-activity', to: B, needsYou: 1, running: 2 },
    ]);
    for (const frame of sent) expect(Object.keys(frame).sort()).toEqual(['needsYou', 'running', 'to', 'type']);
    sender.stop();
  });

  it('sends a newly paired phone the counts at the next tick without re-sending the others', async () => {
    const { state, sent, sender } = harness();
    sender.start();
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    await vi.advanceTimersByTimeAsync(2_000);
    state.phones = [A, B, C];
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS - 2_000);
    expect(tos(sent)).toEqual([C]);
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    expect(sent).toEqual([]);
    sender.stop();
  });

  it('holds a change until 15 s after the last send, then sends the latest counts', async () => {
    const { state, sent, sender } = harness();
    sender.start();
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS); // t = 5 s: first send
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(1_000);
    state.counts = { needsYou: 2, running: 2 };
    await vi.advanceTimersByTimeAsync(2_000);
    state.counts = { needsYou: 3, running: 2 };
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_MIN_INTERVAL_MS - 3_000 - 1); // just before t = 20 s
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); // t = 20 s, 15 s after the send
    expect(sent).toEqual([
      { type: 'push-activity', to: A, needsYou: 3, running: 2 },
      { type: 'push-activity', to: B, needsYou: 3, running: 2 },
    ]);
    sender.stop();
  });

  it('re-sends unchanged counts at 300,000 ms after the last send and not at 295,000 ms', async () => {
    const { sent, sender } = harness();
    sender.start();
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_KEEPALIVE_MS - LIVE_ACTIVITY_POLL_MS);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    expect(tos(sent)).toEqual([A, B]);
    sender.stop();
  });

  it('sends at once when the directory comes back online', async () => {
    const { state, sent, sender } = harness();
    await sender.tick();
    state.online = false;
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    await sender.tick();
    state.online = true;
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    await sender.tick();
    expect(tos(sent)).toEqual([A, B]);
  });

  it('stays due when no phone accepted the send', async () => {
    const { state, sent, sender } = harness();
    state.accept = false;
    await sender.tick();
    state.accept = true;
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    await sender.tick();
    expect(tos(sent)).toEqual([A, B]);
  });

  it('does not read the counts when there are no phones', async () => {
    const { state, counts, sent, sender } = harness();
    state.phones = [];
    await sender.tick();
    expect(counts).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('clamps a count of 12,345 to 9,999', async () => {
    const { sent, sender } = harness({ needsYou: 12_345, running: -3 });
    await sender.tick();
    expect(sent[0]).toEqual({ type: 'push-activity', to: A, needsYou: 9_999, running: 0 });
  });

  it('logs a failing counts read once and keeps ticking', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { counts, sent, sender } = harness();
    counts.mockRejectedValue(new Error('read model busy'));
    await sender.tick();
    await sender.tick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[live-activity] counts failed: read model busy');
    expect(sent).toEqual([]);
    counts.mockResolvedValue({ needsYou: 0, running: 0 });
    await sender.tick();
    expect(tos(sent)).toEqual([A, B]);
    warn.mockRestore();
  });

  it('runs one interval however often start is called, and skips a tick while one is in flight', async () => {
    const { counts, sender } = harness();
    let release: () => void = () => {};
    counts.mockImplementation(() => new Promise<LiveActivityCounts>((resolve) => {
      release = () => resolve({ needsYou: 0, running: 0 });
    }));
    sender.start();
    sender.start();
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS * 3);
    expect(counts).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS);
    expect(counts).toHaveBeenCalledTimes(2);
    sender.stop();
    await vi.advanceTimersByTimeAsync(LIVE_ACTIVITY_POLL_MS * 3);
    expect(counts).toHaveBeenCalledTimes(2);
  });
});
