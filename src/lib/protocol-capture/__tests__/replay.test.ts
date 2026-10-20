/**
 * PAN-4563 — the protocol fixture replay engine, over small inline fixtures.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_CAPTURE_FORMAT, type FrameDirection, type ProtocolFixture, type ProtocolFrame } from '../fixture.js';
import { createProtocolReplay, ReplayMismatchError, type ProtocolReplay } from '../replay.js';

type FrameSpec = [FrameDirection, Record<string, unknown> | string];

function fixtureOf(specs: FrameSpec[]): ProtocolFixture {
  return {
    header: {
      type: 'header',
      format: PROTOCOL_CAPTURE_FORMAT,
      harness: 'codex-app-server',
      provider: null,
      cliVersion: '0.159.0',
      scenario: null,
      recordedAt: '2026-10-20T03:00:00.000Z',
      hostOptions: null,
      scrubbed: true,
    },
    frames: specs.map(([dir, body], seq): ProtocolFrame => (
      typeof body === 'string'
        ? { type: 'frame', seq, dir, t: seq, text: body }
        : { type: 'frame', seq, dir, t: seq, message: body }
    )),
  };
}

/** A replay on a manual scheduler: `tick()` runs one scheduled callback. */
function manualReplay(specs: FrameSpec[]) {
  const pending: Array<() => void> = [];
  const replay = createProtocolReplay(fixtureOf(specs), { schedule: fn => pending.push(fn) });
  const delivered: string[] = [];
  replay.onServerLine(line => delivered.push(line));
  const tick = () => {
    const next = pending.shift();
    if (!next) throw new Error('nothing scheduled');
    next();
  };
  const drain = () => {
    while (pending.length > 0) tick();
  };
  return { replay, delivered, pending, tick, drain };
}

/** A replay on the default setImmediate scheduler. */
function liveReplay(specs: FrameSpec[]): { replay: ProtocolReplay; delivered: string[] } {
  const replay = createProtocolReplay(fixtureOf(specs));
  const delivered: string[] = [];
  replay.onServerLine(line => delivered.push(line));
  return { replay, delivered };
}

const line = (message: Record<string, unknown>) => JSON.stringify(message);

describe('createProtocolReplay', () => {
  it('1. delivers in frames in seq order, one per scheduler tick', async () => {
    const { replay, delivered, pending, tick } = manualReplay([
      ['in', { method: 'a' }],
      ['in', { method: 'b' }],
      ['in', { method: 'c' }],
    ]);
    replay.start();
    expect(delivered).toEqual([]);
    tick();
    expect(delivered).toEqual([line({ method: 'a' })]);
    expect(pending).toHaveLength(1);
    tick();
    tick();
    expect(delivered).toEqual([line({ method: 'a' }), line({ method: 'b' }), line({ method: 'c' })]);
    await replay.done;

    // The default scheduler is setImmediate.
    const live = liveReplay([['in', { method: 'x' }]]);
    live.replay.start();
    expect(live.delivered).toEqual([]);
    await live.replay.done;
    expect(live.delivered).toEqual([line({ method: 'x' })]);
  });

  it('2. stops at an out frame until a matching client line arrives, then continues', async () => {
    const { replay, delivered, pending, drain } = manualReplay([
      ['out', { method: 'initialized' }],
      ['in', { method: 'ready' }],
    ]);
    replay.start();
    expect(pending).toHaveLength(0);
    replay.acceptClientLine(line({ method: 'initialized' }));
    drain();
    expect(delivered).toEqual([line({ method: 'ready' })]);
    await replay.done;
  });

  it('3. rewrites a recorded client-request response id to the live id and keeps server-request ids', async () => {
    const { replay, delivered, drain } = manualReplay([
      ['out', { id: 3, method: 'thread/start', params: { cwd: '<CWD>' } }],
      ['in', { id: 3, result: { thread: { id: 't1' } } }],
      ['in', { id: 0, method: 'item/commandExecution/requestApproval', params: {} }],
    ]);
    replay.start();
    replay.acceptClientLine(line({ id: 'a7', method: 'thread/start', params: { cwd: '/live/cwd' } }));
    drain();
    expect(delivered.map(text => JSON.parse(text))).toEqual([
      { id: 'a7', result: { thread: { id: 't1' } } },
      { id: 0, method: 'item/commandExecution/requestApproval', params: {} },
    ]);
    await replay.done;
  });

  it('4. queues a client line that arrives early and matches it at its recorded position', async () => {
    const { replay, delivered, drain } = manualReplay([
      ['in', { method: 'turn/started' }],
      ['out', { method: 'note' }],
      ['in', { method: 'turn/completed' }],
    ]);
    replay.acceptClientLine(line({ method: 'note' }));
    replay.start();
    drain();
    expect(delivered.map(text => JSON.parse(text).method)).toEqual(['turn/started', 'turn/completed']);
    await replay.done;
    expect(replay.unmatchedClientLines()).toEqual([]);
  });

  it('5. rejects done when the client sends a different method', async () => {
    const { replay, drain } = manualReplay([
      ['in', { method: 'ready' }],
      ['out', { id: 1, method: 'turn/start' }],
      ['in', { id: 1, result: {} }],
    ]);
    replay.start();
    drain();
    const actual = line({ id: 1, method: 'turn/interrupt' });
    replay.acceptClientLine(actual);
    const error = await replay.done.then(() => undefined, (rejection: unknown) => rejection);
    expect(error).toBeInstanceOf(ReplayMismatchError);
    expect((error as Error).message).toContain('seq 1');
    expect((error as Error).message).toContain('turn/start');
    expect((error as Error).message).toContain(actual);
  });

  it('6. rejects done when a client response result differs from the recording', async () => {
    const { replay, drain } = manualReplay([
      ['in', { id: 0, method: 'item/commandExecution/requestApproval', params: {} }],
      ['out', { id: 0, result: { decision: 'accept' } }],
      ['in', { method: 'turn/completed' }],
    ]);
    replay.start();
    drain();
    replay.acceptClientLine(line({ id: 0, result: { decision: 'decline' } }));
    await expect(replay.done).rejects.toThrow(/result differs/);
  });

  it('7. resolves done while a trailing out notification never arrives', async () => {
    const { replay, drain } = manualReplay([
      ['out', { id: 1, method: 'session/prompt' }],
      ['in', { id: 1, result: { stopReason: 'end_turn' } }],
      ['out', { method: 'session/cancel' }],
    ]);
    replay.start();
    replay.acceptClientLine(line({ id: 1, method: 'session/prompt' }));
    drain();
    await replay.done;
  });

  it('8. pauseBefore holds delivery before the matching frame until resume()', async () => {
    const { replay, delivered, pending, drain } = manualReplay([
      ['in', { method: 'turn/started' }],
      ['in', { method: 'thread/status/changed', params: { threadId: 'owner' } }],
      ['in', { method: 'turn/completed', params: { threadId: 'owner' } }],
    ]);
    const paused = replay.pauseBefore({ method: 'turn/completed', threadId: 'owner' });
    replay.start();
    drain();
    const frame = await paused;
    expect(frame.seq).toBe(2);
    expect(delivered.map(text => JSON.parse(text).method)).toEqual(['turn/started', 'thread/status/changed']);
    expect(pending).toHaveLength(0);
    replay.resume();
    drain();
    expect(delivered).toHaveLength(3);
    await replay.done;
  });

  it('9. delivers a text frame verbatim', async () => {
    const { replay, delivered, drain } = manualReplay([['in', 'warning: not json {']]);
    replay.start();
    drain();
    expect(delivered).toEqual(['warning: not json {']);
    await replay.done;
  });

  it('10. reports a client line sent after the last frame as unmatched', async () => {
    const { replay, drain } = manualReplay([
      ['out', { method: 'initialized' }],
      ['in', { method: 'ready' }],
    ]);
    replay.start();
    replay.acceptClientLine(line({ method: 'initialized' }));
    drain();
    await replay.done;
    const extra = line({ id: 9, method: 'turn/start' });
    replay.acceptClientLine(extra);
    expect(replay.unmatchedClientLines()).toEqual([extra]);
  });

  it('11. pauseBefore and awaitingClient reject at once when no later frame matches', async () => {
    const { replay, drain } = manualReplay([
      ['in', { method: 'turn/started' }],
      ['out', { method: 'note' }],
      ['in', { method: 'turn/completed' }],
    ]);
    replay.start();
    drain();
    await expect(replay.pauseBefore({ method: 'turn/started' })).rejects.toThrow(
      /pauseBefore\{ method="turn\/started" \}: no in frame from seq 1 onward matches/,
    );
    await expect(replay.awaitingClient({ method: 'turn/interrupt' })).rejects.toThrow(
      /awaitingClient\{ method="turn\/interrupt" \}: no out frame from seq 1 onward matches/,
    );
    await expect(replay.awaitingClient({ method: 'note' })).resolves.toMatchObject({ seq: 1 });
  });
});
