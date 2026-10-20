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
import { PROTOCOL_CAPTURE_FORMAT, type ProtocolFixture } from '../../protocol-capture/fixture.js';
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
