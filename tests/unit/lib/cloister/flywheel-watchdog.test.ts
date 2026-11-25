/**
 * PAN-5667: the Flywheel watchdog. Fake timers drive the clock: each
 * `patrol()` is one deacon-lite tick, and `vi.advanceTimersByTime` moves the
 * host clock between ticks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));
vi.mock('../../../../src/lib/agents/liveness.js', () => ({ isAlive: vi.fn() }));
vi.mock('../../../../src/lib/agents/delivery.js', () => ({ deliverAgentMessage: vi.fn() }));

import {
  __resetFlywheelWatchdogStateForTests,
  FLYWHEEL_RESUME_MAX_ATTEMPTS,
  FLYWHEEL_RESUME_RETRY_MS,
  watchFlywheelLoop,
  type FlywheelPaneState,
  type FlywheelResumeOutcome,
  type FlywheelTranscriptRead,
  type FlywheelWatchdogDeps,
} from '../../../../src/lib/cloister/flywheel-watchdog.js';
import type { TickMarkerMessage } from '../../../../src/lib/flywheel/tick-marker.js';
import type { LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';

const MIN = 60_000;
const BOOT = Date.parse('2026-11-25T11:31:00Z');
const START = Date.parse('2026-11-25T12:00:00Z');

function conv(overrides: Partial<LegacyConversation> = {}): LegacyConversation {
  return {
    name: 'conv-flywheel',
    tmuxSession: 'conv-flywheel',
    status: 'active',
    createdAt: '2026-11-20T00:00:00.000Z',
    endedAt: null,
    forkStatus: null,
    harness: 'claude-code',
    archivedAt: null,
    ...overrides,
  } as LegacyConversation;
}

function tickMessage(at: number, phase = 'idle'): TickMarkerMessage {
  return {
    role: 'assistant',
    text: `Done.\nflywheel-tick: tick=131 pick=none phase=${phase} in-flight=none needs-you=none`,
    createdAt: new Date(at).toISOString(),
  };
}

interface Harness {
  deps: Partial<FlywheelWatchdogDeps>;
  nudge: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  set: (next: { run?: 'running' | 'paused' | 'idle'; conv?: LegacyConversation | null; transcript?: FlywheelTranscriptRead | null; pane?: FlywheelPaneState; noResume?: boolean; draining?: boolean }) => void;
}

function harness(): Harness {
  const state: {
    run: 'running' | 'paused' | 'idle';
    conv: LegacyConversation | null;
    transcript: FlywheelTranscriptRead | null;
    pane: FlywheelPaneState;
    noResume: boolean;
    draining: boolean;
  } = { run: 'running', conv: conv(), transcript: null, pane: 'idle', noResume: false, draining: false };
  const nudge = vi.fn(async () => undefined);
  const resume = vi.fn(async (): Promise<FlywheelResumeOutcome> => ({ kind: 'resumed' }));
  const log = vi.fn();
  return {
    nudge,
    resume,
    log,
    set: (next) => Object.assign(state, next),
    deps: {
      readRun: async () => ({ conv: state.conv, run: state.run }),
      readTranscript: async () => state.transcript,
      paneState: async () => state.pane,
      nudge,
      resume,
      isNoResumeBoot: () => state.noResume,
      isDraining: () => state.draining,
      bootTimeMs: () => BOOT,
      log,
      now: () => Date.now(),
    },
  };
}

describe('watchFlywheelLoop (PAN-5667)', () => {
  let h: Harness;
  const patrol = () => watchFlywheelLoop(h.deps);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    __resetFlywheelWatchdogStateForTests();
    h = harness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('nudge', () => {
    it('stale tick + idle conversation → exactly one /pan-flywheel nudge for that stall', async () => {
      h.set({ transcript: { messages: [tickMessage(START)], atTurnBoundary: true } });

      // Patrols every minute; the tick goes stale after 20 minutes.
      for (let i = 0; i < 20; i += 1) {
        expect(await patrol()).toEqual([]);
        vi.advanceTimersByTime(MIN);
      }
      expect(h.nudge).not.toHaveBeenCalled();

      vi.advanceTimersByTime(MIN); // 21 min after the tick, inside the 25-minute bound
      const lines = await patrol();
      expect(h.nudge).toHaveBeenCalledTimes(1);
      expect(lines[0]).toMatch(/sent \/pan-flywheel to conv-flywheel/);
      expect(h.log).toHaveBeenCalledWith(expect.stringContaining('restarted the loop'), 'info');

      // The next patrols see the same stale tick and stay quiet.
      for (let i = 0; i < 5; i += 1) {
        vi.advanceTimersByTime(MIN);
        expect(await patrol()).toEqual([]);
      }
      expect(h.nudge).toHaveBeenCalledTimes(1);
    });

    it('nudges the same stall again only after another 20 minutes', async () => {
      h.set({ transcript: { messages: [tickMessage(START - 25 * MIN)], atTurnBoundary: true } });
      await patrol();
      vi.advanceTimersByTime(19 * MIN);
      await patrol();
      expect(h.nudge).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2 * MIN);
      await patrol();
      expect(h.nudge).toHaveBeenCalledTimes(2);
    });

    it('a new stale tick after a nudge is a new stall', async () => {
      h.set({ transcript: { messages: [tickMessage(START - 25 * MIN)], atTurnBoundary: true } });
      await patrol();
      h.set({ transcript: { messages: [tickMessage(START - 25 * MIN), tickMessage(START)], atTurnBoundary: true } });
      vi.advanceTimersByTime(21 * MIN);
      await patrol();
      expect(h.nudge).toHaveBeenCalledTimes(2);
    });

    it('stale tick + mid-turn conversation → no nudge', async () => {
      h.set({ transcript: { messages: [tickMessage(START - 40 * MIN)], atTurnBoundary: false } });
      for (let i = 0; i < 10; i += 1) {
        expect(await patrol()).toEqual([]);
        vi.advanceTimersByTime(MIN);
      }
      expect(h.nudge).not.toHaveBeenCalled();
    });

    it('stale tick + a Herdr pane that is working or blocked → no nudge', async () => {
      h.set({ transcript: { messages: [tickMessage(START - 40 * MIN)], atTurnBoundary: true }, pane: 'busy' });
      expect(await patrol()).toEqual([]);
      expect(h.nudge).not.toHaveBeenCalled();
    });

    it('a fresh tick, no tick, a stopping tick or an unreadable transcript → no nudge', async () => {
      h.set({ transcript: { messages: [tickMessage(START - 5 * MIN)], atTurnBoundary: true } });
      await patrol();
      h.set({ transcript: { messages: [], atTurnBoundary: true } });
      await patrol();
      h.set({ transcript: { messages: [tickMessage(START - 40 * MIN, 'stopping')], atTurnBoundary: true } });
      await patrol();
      h.set({ transcript: null });
      await patrol();
      expect(h.nudge).not.toHaveBeenCalled();
    });

    it('paused flywheel → no nudge', async () => {
      h.set({
        run: 'paused',
        conv: conv({ status: 'ended', endedAt: new Date(BOOT - 60 * MIN).toISOString() }),
        transcript: { messages: [tickMessage(BOOT - 61 * MIN)], atTurnBoundary: true },
      });
      for (let i = 0; i < 30; i += 1) {
        expect(await patrol()).toEqual([]);
        vi.advanceTimersByTime(MIN);
      }
      expect(h.nudge).not.toHaveBeenCalled();
      expect(h.resume).not.toHaveBeenCalled();
    });

    it('a failed delivery is reported once and not retried every minute', async () => {
      h.set({ transcript: { messages: [tickMessage(START - 25 * MIN)], atTurnBoundary: true } });
      h.nudge.mockRejectedValueOnce(new Error('herdr refused'));
      const lines = await patrol();
      expect(lines[0]).toMatch(/could not deliver.*herdr refused/);
      expect(h.log).toHaveBeenCalledWith(expect.stringContaining('herdr refused'), 'warn');
      vi.advanceTimersByTime(MIN);
      expect(await patrol()).toEqual([]);
      expect(h.nudge).toHaveBeenCalledTimes(1);
    });
  });

  describe('resume after a host reboot', () => {
    const beforeBoot = { messages: [tickMessage(BOOT - 30 * MIN)], atTurnBoundary: true };

    it('a row the reboot left active (or the post-boot sweep ended) is resumed once', async () => {
      h.set({ run: 'paused', conv: conv({ status: 'active' }), transcript: beforeBoot });
      expect(await patrol()).toEqual(['watchFlywheelLoop: resumed conv-flywheel after the host reboot']);
      expect(h.resume).toHaveBeenCalledWith(BOOT);

      h.set({ conv: conv({ status: 'ended', endedAt: new Date(BOOT + 2 * MIN).toISOString() }) });
      vi.advanceTimersByTime(10 * MIN);
      expect(await patrol()).toEqual([]);
      expect(h.resume).toHaveBeenCalledTimes(1);
    });

    it('a row ended by the post-boot sweep is resumed', async () => {
      h.set({ run: 'paused', conv: conv({ status: 'ended', endedAt: new Date(BOOT + 2 * MIN).toISOString() }), transcript: beforeBoot });
      await patrol();
      expect(h.resume).toHaveBeenCalledTimes(1);
    });

    it('an operator pause before the boot is left alone', async () => {
      h.set({ run: 'paused', conv: conv({ status: 'ended', endedAt: new Date(BOOT - 5 * MIN).toISOString() }), transcript: beforeBoot });
      await patrol();
      expect(h.resume).not.toHaveBeenCalled();
    });

    it('an operator pause after the boot is left alone: the transcript moved after the boot', async () => {
      h.set({
        run: 'paused',
        conv: conv({ status: 'ended', endedAt: new Date(START).toISOString() }),
        transcript: { messages: [...beforeBoot.messages, tickMessage(BOOT + 10 * MIN)], atTurnBoundary: true },
      });
      await patrol();
      expect(h.resume).not.toHaveBeenCalled();
    });

    it('a stop the dashboard recorded since the boot ends the attempts', async () => {
      h.set({ run: 'paused', conv: conv({ status: 'active' }), transcript: beforeBoot });
      h.resume.mockResolvedValue({ kind: 'refused', reason: 'stopped on purpose' });
      expect((await patrol())[0]).toMatch(/did not resume.*stopped on purpose/);
      vi.advanceTimersByTime(FLYWHEEL_RESUME_RETRY_MS * 3);
      await patrol();
      expect(h.resume).toHaveBeenCalledTimes(1);
    });

    it('a graceful stop, a --no-resume boot, a mid-fork row or a row created after the boot → no resume', async () => {
      h.set({ run: 'paused', conv: conv(), transcript: { messages: [tickMessage(BOOT - 30 * MIN, 'stopping')], atTurnBoundary: true } });
      await patrol();
      h.set({ transcript: beforeBoot, noResume: true });
      await patrol();
      h.set({ noResume: false, conv: conv({ forkStatus: 'pending' }) });
      await patrol();
      h.set({ conv: conv({ createdAt: new Date(BOOT + MIN).toISOString() }), transcript: { messages: [], atTurnBoundary: true } });
      await patrol();
      expect(h.resume).not.toHaveBeenCalled();
    });

    it('never auto-resumes after a safe shutdown: the drain ended the row just before the reboot (D-9)', async () => {
      // `pan shutdown` stopped the idle loop 30 s before the host went down; the
      // next boot consumed the shutdown record. Every other resume rule holds.
      h.set({
        run: 'paused',
        conv: conv({ status: 'ended', endedAt: new Date(BOOT - 30_000).toISOString() }),
        transcript: beforeBoot,
        draining: false,
      });
      for (let i = 0; i < 30; i += 1) {
        expect(await patrol()).toEqual([]);
        vi.advanceTimersByTime(MIN);
      }
      expect(h.resume).not.toHaveBeenCalled();
      expect(h.nudge).not.toHaveBeenCalled();
    });

    it('does nothing while the shutdown record exists (a drain in progress)', async () => {
      // A loop that would otherwise be resumed, then one that would otherwise be nudged.
      h.set({ run: 'paused', conv: conv({ status: 'active' }), transcript: beforeBoot, draining: true });
      expect(await patrol()).toEqual([]);
      h.set({ run: 'running', transcript: { messages: [tickMessage(START - 40 * MIN)], atTurnBoundary: true } });
      expect(await patrol()).toEqual([]);
      expect(h.resume).not.toHaveBeenCalled();
      expect(h.nudge).not.toHaveBeenCalled();
    });

    it('a resume whose /pan-flywheel delivery failed is nudged on the next patrol', async () => {
      // The conversation respawned, but sending the skill threw, so the route answered 500.
      h.set({ run: 'paused', conv: conv({ status: 'active' }), transcript: beforeBoot });
      h.resume.mockResolvedValueOnce({ kind: 'failed', reason: 'Flywheel message not delivered' });
      await patrol();
      expect(h.resume).toHaveBeenCalledTimes(1);

      // Now running, idle, and its newest tick is from before the boot.
      h.set({ run: 'running' });
      vi.advanceTimersByTime(MIN);
      expect((await patrol())[0]).toMatch(/sent \/pan-flywheel/);
      expect(h.nudge).toHaveBeenCalledTimes(1);
      expect(h.resume).toHaveBeenCalledTimes(1);
    });

    it('a loop that never printed a tick is not resumed after a reboot', async () => {
      h.set({
        run: 'paused',
        conv: conv({ status: 'active' }),
        transcript: { messages: [{ role: 'user', text: '/pan-flywheel', createdAt: new Date(BOOT - 30 * MIN).toISOString() }], atTurnBoundary: false },
      });
      await patrol();
      expect(h.resume).not.toHaveBeenCalled();
    });

    it('a failed resume is retried after the retry delay, at most the attempt limit', async () => {
      h.set({ run: 'paused', conv: conv(), transcript: beforeBoot });
      h.resume.mockResolvedValue({ kind: 'failed', reason: 'dashboard unreachable' });
      await patrol();
      vi.advanceTimersByTime(MIN);
      await patrol();
      expect(h.resume).toHaveBeenCalledTimes(1);
      for (let i = 1; i < FLYWHEEL_RESUME_MAX_ATTEMPTS + 2; i += 1) {
        vi.advanceTimersByTime(FLYWHEEL_RESUME_RETRY_MS);
        await patrol();
      }
      expect(h.resume).toHaveBeenCalledTimes(FLYWHEEL_RESUME_MAX_ATTEMPTS);
      expect(h.log).toHaveBeenLastCalledWith(expect.stringContaining('stopped trying'), 'warn');
    });
  });
});

describe('watchFlywheelLoop failure isolation (PAN-5667)', () => {
  it('a failing read returns no lines instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    __resetFlywheelWatchdogStateForTests();
    await expect(watchFlywheelLoop({ readRun: async () => { throw new Error('database locked'); } })).resolves.toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('readWatchdogTranscriptFile against real Claude JSONL (PAN-5667)', () => {
  let dir: string;
  beforeEach(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    dir = await mkdtemp(join(tmpdir(), 'flywheel-watchdog-'));
  });
  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  });

  const user = (uuid: string, ts: string, text: string) =>
    JSON.stringify({ type: 'user', uuid, timestamp: ts, message: { role: 'user', content: text } });
  const assistant = (uuid: string, ts: string, content: unknown[], stopReason: string) =>
    JSON.stringify({ type: 'assistant', uuid, timestamp: ts, message: { id: `msg-${uuid}`, role: 'assistant', model: 'claude', type: 'message', stop_reason: stopReason, content } });
  const tick = 'flywheel-tick: tick=7 pick=none phase=idle in-flight=none needs-you=none';

  async function read(name: string, lines: string[]) {
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const file = join(dir, `${name}.jsonl`);
    await writeFile(file, `${lines.join('\n')}\n`);
    const { readWatchdogTranscriptFile } = await import('../../../../src/lib/cloister/flywheel-watchdog.js');
    return readWatchdogTranscriptFile(file);
  }

  it('an ended turn is a turn boundary, and its tick is found', async () => {
    const result = await read('ended', [
      user('u1', '2026-11-25T12:00:00.000Z', '/pan-flywheel'),
      assistant('a1', '2026-11-25T12:01:00.000Z', [{ type: 'text', text: `Done.\n${tick}` }], 'end_turn'),
    ]);
    expect(result?.atTurnBoundary).toBe(true);
    expect(result?.messages.at(-1)?.text).toContain('flywheel-tick:');
  });

  it('a tool call waiting on its result is not a turn boundary', async () => {
    const result = await read('pending-tool', [
      user('u1', '2026-11-25T12:00:00.000Z', '/pan-flywheel'),
      assistant('a1', '2026-11-25T12:01:00.000Z', [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'toolu_1', name: 'AskUserQuestion', input: { questions: [] } },
      ], 'tool_use'),
    ]);
    expect(result?.atTurnBoundary).toBe(false);
  });

  it('a user message after an ended turn is not a turn boundary', async () => {
    const result = await read('trailing-user', [
      assistant('a1', '2026-11-25T12:01:00.000Z', [{ type: 'text', text: `Done.\n${tick}` }], 'end_turn'),
      user('u2', '2026-11-25T12:30:00.000Z', 'what is in flight?'),
    ]);
    expect(result?.atTurnBoundary).toBe(false);
  });

  it('a missing file reads as null', async () => {
    const { readWatchdogTranscriptFile } = await import('../../../../src/lib/cloister/flywheel-watchdog.js');
    await expect(readWatchdogTranscriptFile('/nonexistent/flywheel.jsonl')).resolves.toBeNull();
  });
});
