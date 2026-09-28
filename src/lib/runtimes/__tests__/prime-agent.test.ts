import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRuntime, getGlobalRegistry } from '../index.js';
import { PRIME_AGENT_KILL_GRACE_MS, PrimeAgentRuntimeSync } from '../prime-agent.js';

describe('PrimeAgentRuntimeSync (PAN-3668 WI-15)', () => {
  let home: string;
  const agentId = 'agent-prime-rt';
  const agentDir = () => join(home, 'agents', agentId);

  function runtime(overrides: ConstructorParameters<typeof PrimeAgentRuntimeSync>[0] = {}) {
    return new PrimeAgentRuntimeSync({ home: () => home, ...overrides });
  }

  function writeSession(): string {
    const sessionFile = join(agentDir(), 'prime-sessions', '01a0.jsonl');
    mkdirSync(join(agentDir(), 'prime-sessions'), { recursive: true });
    writeFileSync(sessionFile, '{"type":"session"}\n');
    writeFileSync(join(agentDir(), 'prime-agent-session-file'), `${sessionFile}\n`);
    return sessionFile;
  }

  function writeStats(snapshot: Record<string, unknown>): void {
    mkdirSync(agentDir(), { recursive: true });
    writeFileSync(join(agentDir(), 'prime-agent-stats.json'), JSON.stringify(snapshot));
  }

  function writeHostSocket(): void {
    mkdirSync(join(home, 'sockets'), { recursive: true });
    writeFileSync(join(home, 'sockets', `prime-agent-${agentId}.sock`), '');
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-prime-runtime-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(home, { recursive: true, force: true });
  });

  it('is registered and dispatched for prime-agent', () => {
    expect(getRuntime('prime-agent')).toBeInstanceOf(PrimeAgentRuntimeSync);
    expect(getGlobalRegistry().get('prime-agent')?.getHarnessBehavior().displayName).toBe('Prime Agent');
  });

  it('closes the pane and reaps the daemon even when interrupt rejects', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const rt = runtime({
      interrupt: vi.fn(async () => { order.push('interrupt'); throw new Error('socket missing'); }),
      closePane: vi.fn(async () => { order.push('close'); }),
      reapDaemon: vi.fn(async () => { order.push('reap'); }),
    });

    const killed = rt.killAgent(agentId);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['interrupt']);
    await vi.advanceTimersByTimeAsync(PRIME_AGENT_KILL_GRACE_MS);
    await killed;

    expect(order).toEqual(['interrupt', 'close', 'reap']);
  });

  it('bounds a hung interrupt at 5 s before closing and reaping', async () => {
    vi.useFakeTimers();
    const closePane = vi.fn(async () => {});
    const reapDaemon = vi.fn(async () => {});
    const rt = runtime({ interrupt: () => new Promise(() => {}), closePane, reapDaemon });

    const killed = rt.killAgent(agentId);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(closePane).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1 + PRIME_AGENT_KILL_GRACE_MS);
    await killed;

    expect(closePane).toHaveBeenCalledWith(agentId);
    expect(reapDaemon).toHaveBeenCalledWith(agentId);
  });

  it('reads the heartbeat from the host stats while the host socket exists', () => {
    writeSession();
    writeHostSocket();
    writeStats({ lastEventAt: '2026-09-25T12:00:00.000Z', stats: null });

    expect(runtime().getHeartbeat(agentId)).toEqual({
      timestamp: new Date('2026-09-25T12:00:00.000Z'),
      agentId,
      source: 'active-heartbeat',
      confidence: 'high',
    });
  });

  it('falls back to the session file mtime once the host is gone', () => {
    const sessionFile = writeSession();
    writeStats({ lastEventAt: '2026-09-25T12:00:00.000Z', stats: null });
    const mtime = new Date('2026-09-24T08:30:00.000Z');
    utimesSync(sessionFile, mtime, mtime);

    const rt = runtime();
    expect(rt.getSessionPath(agentId)).toBe(sessionFile);
    expect(rt.getHeartbeat(agentId)).toEqual({ timestamp: mtime, agentId, source: 'jsonl', confidence: 'medium' });
    expect(rt.getLastActivity(agentId)).toEqual(mtime);
  });

  it('maps tokens and cost from the stats snapshot', () => {
    writeStats({
      lastEventAt: '2026-09-25T12:00:00.000Z',
      stats: { tokens: { input: 50000, output: 10000, cacheRead: 40000, cacheWrite: 5000, total: 105000 }, cost: 0.45 },
    });

    const rt = runtime();
    expect(rt.getTokenUsage(agentId)).toEqual({ inputTokens: 50000, outputTokens: 10000, cacheReadTokens: 40000, cacheWriteTokens: 5000 });
    expect(rt.getSessionCost(agentId)).toEqual({ inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0.45, currency: 'USD' });
  });

  it('returns null usage, cost and session path when nothing is recorded', () => {
    const rt = runtime();
    expect(rt.getTokenUsage(agentId)).toBeNull();
    expect(rt.getSessionCost(agentId)).toBeNull();
    expect(rt.getSessionPath(agentId)).toBeNull();
    expect(rt.getHeartbeat(agentId)).toBeNull();
  });
});
