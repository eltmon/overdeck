import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShutdownSnapshot } from '@overdeck/contracts';

import { DashboardUnreachableError } from '../dashboard-call.js';
import {
  DASHBOARD_DOWN_TEXT,
  OVERDUE_HINT,
  SHUTDOWN_POLL_MS,
  STARTED_TEXT,
  shutdownCommand,
  type ShutdownDeps,
} from '../shutdown.js';

const START = Date.parse('2026-11-15T12:00:00.000Z');

function snapshot(overrides: Partial<ShutdownSnapshot> = {}): ShutdownSnapshot {
  return {
    phase: 'draining',
    startedAt: new Date(START).toISOString(),
    deadlineAt: new Date(START + 120_000).toISOString(),
    overdue: false,
    reboot: false,
    force: 'never',
    pending: [{
      id: 'agent-pan-1',
      kind: 'agent',
      label: 'PAN-1 work agent',
      activity: 'working',
      tool: 'Bash',
      toolDescription: 'Run tests',
      toolStartedAt: new Date(START - 30_000).toISOString(),
    }],
    writers: [],
    stoppedCount: 0,
    warnings: [],
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Harness {
  deps: Partial<ShutdownDeps>;
  lines: string[];
  calls: Array<{ path: string; method: string; body?: unknown }>;
  downCommand: ReturnType<typeof vi.fn>;
  execFile: ReturnType<typeof vi.fn>;
}

/** `gets` answers successive GET /api/shutdown calls; the last one repeats. */
function harness(options: {
  gets?: Array<ShutdownSnapshot | null | Error>;
  post?: Response;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  recordPhase?: string | null;
} = {}): Harness {
  const lines: string[] = [];
  const calls: Harness['calls'] = [];
  const gets = [...(options.gets ?? [null])];
  const downCommand = vi.fn(async () => {});
  const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }));
  const callDashboard = vi.fn(async (path: string, init: { method: string; body?: unknown }) => {
    calls.push({ path, method: init.method, body: init.body });
    if (init.method === 'GET') {
      const next = gets.length > 1 ? gets.shift() : gets[0];
      if (next instanceof Error) throw next;
      return json({ shutdown: next ?? null });
    }
    if (path === '/api/shutdown') return options.post ?? json({ shutdown: snapshot() }, 202);
    return json({ ok: true });
  });
  return {
    lines,
    calls,
    downCommand,
    execFile,
    deps: {
      callDashboard,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      env: options.env ?? {},
      log: (line) => lines.push(line),
      downCommand,
      execFile,
      platform: options.platform ?? 'linux',
      now: () => Date.now(),
      readRecordPhase: async () => options.recordPhase ?? null,
    },
  };
}

describe('pan shutdown (PAN-5342)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exitCode = undefined;
  });

  describe('--finish', () => {
    it('waits, runs the pan down teardown, then reboots with --reboot on Linux', async () => {
      const h = harness({ platform: 'linux' });
      const run = shutdownCommand({ finish: true, reboot: true }, h.deps);
      await vi.advanceTimersByTimeAsync(1_499);
      expect(h.downCommand).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await run;

      expect(h.downCommand).toHaveBeenCalledWith({});
      expect(h.execFile).toHaveBeenCalledWith('systemctl', ['reboot'], expect.anything());
      expect(h.downCommand.mock.invocationCallOrder[0]).toBeLessThan(h.execFile.mock.invocationCallOrder[0]!);
      expect(process.exitCode).toBeUndefined();
    });

    it('does not reboot without --reboot and prints that it is safe to reboot', async () => {
      const h = harness({ platform: 'linux' });
      const run = shutdownCommand({ finish: true }, h.deps);
      await vi.advanceTimersByTimeAsync(1_500);
      await run;

      expect(h.downCommand).toHaveBeenCalledOnce();
      expect(h.execFile).not.toHaveBeenCalled();
      expect(h.lines).toContain('Overdeck is shut down. It is safe to reboot.');
    });

    it('does not reboot off Linux even with --reboot', async () => {
      const h = harness({ platform: 'darwin' });
      const run = shutdownCommand({ finish: true, reboot: true }, h.deps);
      await vi.advanceTimersByTimeAsync(1_500);
      await run;

      expect(h.downCommand).toHaveBeenCalledOnce();
      expect(h.execFile).not.toHaveBeenCalled();
    });
  });

  it('starts the drain and exits right after the POST when run inside a managed session', async () => {
    const h = harness({ env: { OVERDECK_AGENT_ID: 'agent-pan-9' } });
    await shutdownCommand({ deadline: '60', reboot: true, wait: true }, h.deps);

    expect(h.calls).toEqual([
      { path: '/api/shutdown', method: 'GET', body: undefined },
      { path: '/api/shutdown', method: 'POST', body: { deadlineSeconds: 60, reboot: true, force: false } },
    ]);
    expect(h.lines).toEqual([STARTED_TEXT]);
    expect(process.exitCode).toBeUndefined();
  });

  it('exits right after the POST with --no-wait or from a conversation', async () => {
    const noWait = harness();
    await shutdownCommand({ wait: false }, noWait.deps);
    expect(noWait.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(noWait.lines).toEqual([STARTED_TEXT]);

    const conversation = harness({ env: { OVERDECK_CONVERSATION: 'conv-1' } });
    await shutdownCommand({ wait: true }, conversation.deps);
    expect(conversation.calls.map((c) => c.method)).toEqual(['GET', 'POST']);
  });

  it('follows the drain, prints the overdue straggler lines once, then reports safe to reboot', async () => {
    const overdue = snapshot({ overdue: true, deadlineAt: new Date(START - 1_000).toISOString() });
    const h = harness({
      gets: [null, overdue, overdue, overdue, snapshot({ phase: 'complete', pending: [], stoppedCount: 3, warnings: ['/w/a: index.lock is present'] })],
    });
    const run = shutdownCommand({ wait: true }, h.deps);
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(SHUTDOWN_POLL_MS);
    await run;

    expect(h.lines.filter((line) => line === OVERDUE_HINT)).toHaveLength(1);
    expect(h.lines.filter((line) => line.startsWith('  agent-pan-1: Bash (Run tests), '))).toHaveLength(1);
    expect(h.lines.at(-2)).toBe('Warning: /w/a: index.lock is present');
    expect(h.lines.at(-1)).toBe('Safe to reboot.');
    expect(process.exitCode).toBeUndefined();
  });

  it('exits 1 when the drain disappears before completing (cancelled)', async () => {
    const h = harness({ gets: [null, snapshot(), null] });
    const run = shutdownCommand({ wait: true }, h.deps);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_POLL_MS * 2);
    await run;

    expect(h.lines.at(-1)).toBe('The shutdown was cancelled.');
    expect(process.exitCode).toBe(1);
  });

  it('prints the dashboard-down text and exits 1 when the dashboard does not answer', async () => {
    const h = harness({ gets: [new DashboardUnreachableError('ECONNREFUSED')] });
    await shutdownCommand({ wait: true }, h.deps);

    expect(h.lines).toEqual([DASHBOARD_DOWN_TEXT]);
    expect(process.exitCode).toBe(1);
  });

  it('treats a dashboard that stops after the record reached complete as done', async () => {
    const h = harness({ gets: [null, new DashboardUnreachableError('ECONNREFUSED')], recordPhase: 'complete' });
    const run = shutdownCommand({ wait: true }, h.deps);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_POLL_MS);
    await run;

    expect(h.lines.at(-1)).toBe('Safe to reboot.');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints the 409 refusal and exits 1', async () => {
    const h = harness({ post: json({ error: 'A pan reload or pan restart is in progress (pid 42).', code: 'restart-in-progress' }, 409) });
    await shutdownCommand({ wait: true }, h.deps);

    expect(h.lines).toEqual(['A pan reload or pan restart is in progress (pid 42).']);
    expect(process.exitCode).toBe(1);
  });

  it('forces all on a running drain with --force instead of starting a new one', async () => {
    const h = harness({ gets: [snapshot()], env: { OVERDECK_AGENT_ID: 'agent-pan-9' } });
    await shutdownCommand({ force: true, wait: true }, h.deps);

    expect(h.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/shutdown', 'POST /api/shutdown/force-all']);
  });

  it('refuses a deadline outside 10..3600 seconds without calling the dashboard', async () => {
    const h = harness();
    await shutdownCommand({ deadline: '5', wait: true }, h.deps);

    expect(h.calls).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it('--status prints the phase, time left and one line per pending session', async () => {
    const h = harness({ gets: [snapshot({ writers: [{ kind: 'auto-merge', label: 'Merging PAN-2' }] })] });
    await shutdownCommand({ status: true }, h.deps);

    expect(h.lines).toEqual([
      'Shutdown draining: 120s left, 0 stopped',
      'Pending sessions (1):',
      '  agent-pan-1: Bash (Run tests), 30s',
      'Pending writers (1):',
      '  auto-merge: Merging PAN-2',
    ]);
  });

  it('--cancel posts the cancel and prints the resume hint', async () => {
    const h = harness();
    await shutdownCommand({ cancel: true }, h.deps);

    expect(h.calls).toEqual([{ path: '/api/shutdown/cancel', method: 'POST', body: undefined }]);
    expect(h.lines).toEqual(['Shutdown cancelled. Stopped sessions are offered under Needs you.']);
  });
});
