import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-4595: proves the CLI health path sees the transcript heartbeat once
// src/lib/health.ts imports the runtime registry. Unlike
// health-runtime-state.test.ts (whose liveness mock is wholesale and never
// exercises the heartbeat), this file keeps liveness.ts and runtimes/index.js
// real so the registration under test actually runs.

const { isAliveMock } = vi.hoisted(() => ({
  isAliveMock: vi.fn(),
}));

vi.mock('../../src/lib/agents/liveness.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/agents/liveness.js')>();
  return {
    ...actual,
    isAlive: isAliveMock,
  };
});

vi.mock('../../src/lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/tmux.js')>();
  return {
    ...actual,
    listPaneValuesSync: () => {
      throw new Error('no tmux on Herdr');
    },
    listSessionNames: () => Effect.succeed([]),
  };
});

const AGENT_ID = 'agent-pan-4595-heartbeat-test';

describe('PAN-4595: Herdr agent heartbeat reaches the CLI health path', () => {
  let home: string;
  let agentDir: string;
  let transcriptPath: string;
  let prevOverdeckHome: string | undefined;

  beforeEach(() => {
    isAliveMock.mockReset();
    isAliveMock.mockResolvedValue({ alive: true, paneAlive: true });

    home = mkdtempSync(join(tmpdir(), 'pan-4595-'));
    prevOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
    vi.resetModules();

    agentDir = join(home, 'agents', AGENT_ID);
    mkdirSync(agentDir, { recursive: true });

    const now = new Date();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(agentDir, 'state.json'),
      JSON.stringify({
        id: AGENT_ID,
        role: 'work',
        status: 'running',
        harness: 'claude-code',
        workspace: join(home, 'ws'),
        lastActivity: threeHoursAgo,
      }),
    );

    transcriptPath = join(home, 'transcript.jsonl');
    writeFileSync(transcriptPath, `${JSON.stringify({ type: 'test' })}\n`);

    writeFileSync(
      join(agentDir, 'sessions.json'),
      `${JSON.stringify({
        sessionId: 's1',
        at: now.toISOString(),
        source: 'heartbeat-hook',
        harness: 'claude-code',
        path: transcriptPath,
      })}\n`,
    );
  });

  afterEach(() => {
    if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prevOverdeckHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('PAN-4595: a live Herdr agent with a fresh transcript is healthy on the CLI path', async () => {
    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent(AGENT_ID));

    expect(health.status).toBe('healthy');
    expect(health.consecutiveFailures).toBe(0);
    expect(Date.now() - Date.parse(health.lastActivity!)).toBeLessThan(60_000);
  });

  it('PAN-4595: a stale transcript still reads stuck', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(transcriptPath, threeHoursAgo, threeHoursAgo);
    expect(existsSync(transcriptPath)).toBe(true);

    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent(AGENT_ID));

    expect(health.status).toBe('stuck');
    expect(health.reason).toMatch(/No activity for \d+ minutes/);
  });

  it('PAN-4595: a prior false-stuck count resets on the first healthy ping', async () => {
    writeFileSync(
      join(agentDir, 'health.json'),
      JSON.stringify({
        agentId: AGENT_ID,
        status: 'healthy',
        consecutiveFailures: 2,
        forceKillCount: 0,
        recoveryCount: 0,
        inCooldown: false,
      }),
    );

    const { pingAgent } = await import('../../src/lib/health.js');
    const health = await Effect.runPromise(pingAgent(AGENT_ID));

    expect(health.consecutiveFailures).toBe(0);
  });
});
