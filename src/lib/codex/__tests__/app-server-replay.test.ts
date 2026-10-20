/**
 * PAN-4563 — replay-backed protocol tests for the Codex app-server client.
 *
 * Each case plays a fixture recorded from a live `codex app-server` (see
 * docs/PROTOCOL-REPLAY-TESTS.md) to the real stdio transport, manager, and
 * host. Expected ids come from the fixture, never from literals, so a
 * re-recording needs no test edits. Where a test relies on a provider
 * ordering, it first asserts that ordering on the fixture itself.
 *
 * Timers: setTimeout/setInterval are faked so the host's rollout-path poll and
 * the manager's request timeouts never run; setImmediate stays real because
 * the replay schedules on it.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameKind, PROTOCOL_CAPTURE_FORMAT, type ProtocolFixture, type ProtocolFrame } from '../../protocol-capture/fixture.js';
import { startCodexReplay, type CodexReplay } from './replay-app-server.js';

let overdeckHome: string;
let active: CodexReplay | undefined;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  overdeckHome = await mkdtemp(join(tmpdir(), 'pan-codex-replay-'));
});

afterEach(async () => {
  vi.useRealTimers();
  active?.manager.stop();
  active = undefined;
  await rm(overdeckHome, { recursive: true, force: true });
});

async function start(fixture: string | ProtocolFixture): Promise<CodexReplay> {
  active = await startCodexReplay(fixture, { overdeckHome });
  return active;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function params(frame: ProtocolFrame): Record<string, unknown> {
  return record(frame.message?.params);
}

function frameThread(frame: ProtocolFrame): unknown {
  return params(frame).threadId ?? record(params(frame).thread).id;
}

/** Facts every case reads from its fixture instead of hard-coding ids. */
function fixtureFacts(fixture: ProtocolFixture) {
  const frames = fixture.frames;
  const threadStart = frames.find(frame => frame.dir === 'out' && frame.message?.method === 'thread/start');
  const threadStartResponse = frames.find(frame =>
    frame.dir === 'in' && frameKind(frame) === 'response' && frame.message?.id === threadStart?.message?.id);
  const ownerThreadId = record(record(threadStartResponse?.message?.result).thread).id as string;
  const isOwner = (frame: ProtocolFrame) => frameThread(frame) === ownerThreadId;
  const index = (predicate: (frame: ProtocolFrame) => boolean) => frames.findIndex(predicate);
  const ownerTurnStarted = frames.find(frame => frame.dir === 'in' && frame.message?.method === 'turn/started' && isOwner(frame));
  const ownerTurnId = record(params(ownerTurnStarted ?? { type: 'frame', seq: -1, dir: 'in', t: 0 }).turn).id as string;
  const ownerCompletedIndex = index(frame => frame.dir === 'in' && frame.message?.method === 'turn/completed' && isOwner(frame));
  const ownerTurnStatus = record(params(frames[ownerCompletedIndex]!).turn).status;
  return { frames, ownerThreadId, ownerTurnId, ownerCompletedIndex, ownerTurnStatus, isOwner, index };
}

function prompt(replay: CodexReplay['replay']): string {
  return String(replay.fixture.header.hostOptions?.prompt);
}

describe('codex replay harness', () => {
  it('runs the real manager handshake against an inline fixture', async () => {
    const fixture: ProtocolFixture = {
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
      frames: [
        { type: 'frame', seq: 0, dir: 'out', t: 0, message: { id: 1, method: 'initialize', params: {} } },
        { type: 'frame', seq: 1, dir: 'in', t: 1, message: { id: 1, result: { userAgent: 'codex' } } },
        { type: 'frame', seq: 2, dir: 'out', t: 2, message: { method: 'initialized' } },
      ],
    };
    const { manager, replay } = await start(fixture);
    expect(manager.getState().state).toBe('ready');
    await replay.done;
    expect(replay.unmatchedClientLines()).toEqual([]);
  });
});

describe('codex case 1: idle status vs turn/completed', () => {
  it('keeps the owner turn running until turn/completed, whatever the idle status says', async () => {
    const { replay, manager, host, lines } = await start('turn-idle');
    const facts = fixtureFacts(replay.fixture);
    const isIdleStatus = (frame: ProtocolFrame) =>
      frame.message?.method === 'thread/status/changed' && facts.isOwner(frame) && record(params(frame).status).type === 'idle';
    const idleIndex = facts.index(frame => frame.dir === 'in' && isIdleStatus(frame));
    expect(idleIndex, 're-check case 1 against the new CLI: no owner idle thread/status/changed recorded').toBeGreaterThanOrEqual(0);
    expect(idleIndex, 're-check case 1 against the new CLI: the idle status no longer precedes turn/completed').toBeLessThan(facts.ownerCompletedIndex);

    const idlePause = replay.pauseBefore({ dir: 'in', where: isIdleStatus });
    const completedPause = replay.pauseBefore({ method: 'turn/completed', threadId: facts.ownerThreadId });
    expect(await host.handleOp({ op: 'message', content: prompt(replay) })).toMatchObject({ status: 200 });

    await idlePause;
    expect(manager.getState()).toMatchObject({ state: 'running', activeTurnId: facts.ownerTurnId });
    replay.resume();
    await completedPause;
    // The idle status has been delivered; the turn is still running.
    expect(manager.getState()).toMatchObject({ state: 'running', activeTurnId: facts.ownerTurnId });
    replay.resume();
    await replay.done;

    expect(manager.getState()).toMatchObject({ state: 'idle', activeTurnId: undefined, lastTurnStatus: facts.ownerTurnStatus });
    expect(facts.ownerTurnStatus).toBe('completed');
    expect(host.status().pendingRequests).toEqual([]);
    expect(lines.filter(line => line.startsWith('[turn]'))).toEqual(['[turn] started', '[turn] completed']);
    expect(replay.unmatchedClientLines()).toEqual([]);
  });
});

describe('codex case 2: interrupt response before the interrupted state', () => {
  it('keeps the turn active after the interrupt response and ends it on turn/completed interrupted', async () => {
    const { replay, manager, host } = await start('interrupt');
    const facts = fixtureFacts(replay.fixture);
    const interruptRequest = facts.frames.find(frame => frame.dir === 'out' && frame.message?.method === 'turn/interrupt');
    const interruptResponseIndex = facts.index(frame =>
      frame.dir === 'in' && frameKind(frame) === 'response' && frame.message?.id === interruptRequest?.message?.id);
    expect(interruptResponseIndex, 're-check case 2 against the new CLI: no turn/interrupt response recorded').toBeGreaterThanOrEqual(0);
    expect(interruptResponseIndex, 're-check case 2 against the new CLI: turn/completed now precedes the interrupt response')
      .toBeLessThan(facts.ownerCompletedIndex);

    const awaitingInterrupt = replay.awaitingClient({ dir: 'out', method: 'turn/interrupt' });
    expect(await host.handleOp({ op: 'message', content: prompt(replay) })).toMatchObject({ status: 200 });
    await awaitingInterrupt;
    expect(manager.getState()).toMatchObject({ state: 'running', activeTurnId: facts.ownerTurnId });

    const completedPause = replay.pauseBefore({ method: 'turn/completed', threadId: facts.ownerThreadId });
    expect(await host.handleOp({ op: 'interrupt' })).toMatchObject({ status: 200 });
    await completedPause;
    // The interrupt response alone does not end the turn.
    expect(manager.getState()).toMatchObject({ state: 'running', activeTurnId: facts.ownerTurnId });

    replay.resume();
    await replay.done;
    expect(facts.ownerTurnStatus).toBe('interrupted');
    expect(manager.getState()).toMatchObject({ state: 'idle', activeTurnId: undefined, lastTurnStatus: facts.ownerTurnStatus });
    expect(host.status().lastTurnStatus).toBe('interrupted');
    expect(replay.unmatchedClientLines()).toEqual([]);
  });
});

describe('codex case 3: sub-agent turn completes before the parent', () => {
  it('renders the child completion without ending the owner turn', async () => {
    const { replay, manager, host, lines } = await start('subagent');
    const facts = fixtureFacts(replay.fixture);
    const isSpawn = (frame: ProtocolFrame) => {
      const item = record(params(frame).item);
      return frame.dir === 'in' && facts.isOwner(frame) && item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent'
        && Array.isArray(item.receiverThreadIds) && item.receiverThreadIds.length > 0;
    };
    const spawnIndex = facts.index(isSpawn);
    expect(spawnIndex, 're-check case 3 against the new CLI: no owner spawnAgent item names a receiver').toBeGreaterThanOrEqual(0);
    const childThreadId = (record(params(facts.frames[spawnIndex]!).item).receiverThreadIds as string[])[0]!;
    const childFrame = (method: string) => facts.index(frame =>
      frame.dir === 'in' && frame.message?.method === method && frameThread(frame) === childThreadId);
    const childCompletedIndex = childFrame('turn/completed');
    expect(spawnIndex, 're-check case 3 against the new CLI: the child completed before its spawn item named it')
      .toBeLessThan(childCompletedIndex);
    expect(childCompletedIndex, 're-check case 3 against the new CLI: the child no longer completes before the owner')
      .toBeLessThan(facts.ownerCompletedIndex);
    const label = childThreadId.slice(-8);

    const completedPause = replay.pauseBefore({ method: 'turn/completed', threadId: facts.ownerThreadId });
    expect(await host.handleOp({ op: 'message', content: prompt(replay) })).toMatchObject({ status: 200 });
    await completedPause;
    expect(manager.getState()).toMatchObject({ state: 'running', activeTurnId: facts.ownerTurnId });
    expect(manager.threadScope(childThreadId)).toBe('descendant');
    expect(lines).toContain(`[turn sub:${label}] completed`);
    // PAN-4568: codex announces the child only when the spawn item completes, and
    // the child's turn/started can arrive first, labeled thread:; flip when fixed.
    const startedLabel = childFrame('turn/started') < spawnIndex ? 'thread' : 'sub';
    expect(lines).toContain(`[turn ${startedLabel}:${label}] started`);

    replay.resume();
    await replay.done;
    expect(manager.getState()).toMatchObject({ state: 'idle', activeTurnId: undefined, lastTurnStatus: 'completed' });
    expect(facts.ownerTurnStatus).toBe('completed');
    expect(replay.unmatchedClientLines()).toEqual([]);
  });
});
