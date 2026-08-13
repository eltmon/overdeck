import { closeSync, mkdtempSync, openSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PrimeAgentRuntimeSync, type PrimeAgentRuntimeController } from '../prime-agent.js';
import { getGlobalRegistry } from '../index.js';

function controller(overrides: Partial<PrimeAgentRuntimeController> = {}): PrimeAgentRuntimeController {
  return {
    spawn: vi.fn(async () => ({ sessionId: 'prime-session', sessionPath: '/sessions/prime.jsonl' })),
    send: vi.fn(async () => undefined), abort: vi.fn(async () => undefined), terminate: vi.fn(async () => undefined),
    isRunning: vi.fn(async () => true), stats: vi.fn(() => null), lastEventAt: vi.fn(() => null), sessionPath: vi.fn(() => null),
    ...overrides,
  };
}

describe('PrimeAgentRuntimeSync', () => {
  it('is registered in the global runtime registry', () => {
    expect(getGlobalRegistry().get('prime-agent')).toBeInstanceOf(PrimeAgentRuntimeSync);
  });

  it('prefers live RPC event activity and falls back to detached JSONL mtime', () => {
    const liveAt = new Date('2026-08-12T12:00:00Z');
    const live = new PrimeAgentRuntimeSync({ controller: controller({ lastEventAt: () => liveAt }) });
    expect(live.getHeartbeat('agent-pan-1')).toMatchObject({ timestamp: liveAt, source: 'active-heartbeat', confidence: 'high' });

    const path = join(mkdtempSync(join(tmpdir(), 'prime-runtime-')), 'session.jsonl');
    closeSync(openSync(path, 'w'));
    const detachedAt = new Date('2026-08-12T11:00:00Z');
    utimesSync(path, detachedAt, detachedAt);
    const detached = new PrimeAgentRuntimeSync({ controller: controller({ sessionPath: () => path }) });
    expect(detached.getHeartbeat('agent-pan-1')).toMatchObject({ timestamp: detachedAt, source: 'jsonl', confidence: 'medium' });
  });

  it('returns the recorded session path and aborts before termination', async () => {
    const order: string[] = [];
    const runtime = new PrimeAgentRuntimeSync({ controller: controller({
      sessionPath: () => '/sessions/prime.jsonl',
      abort: async () => { order.push('abort'); }, terminate: async () => { order.push('terminate'); },
    }) });
    expect(runtime.getSessionPath('agent-pan-1')).toBe('/sessions/prime.jsonl');
    await runtime.killAgent('agent-pan-1');
    expect(order).toEqual(['abort', 'terminate']);
  });

  it('reports session stats without inventing missing values', () => {
    const runtime = new PrimeAgentRuntimeSync({ controller: controller({ stats: () => ({ tokens: { input: 10, output: 2 }, cost: 0.5 }) }) });
    expect(runtime.getTokenUsage('agent-pan-1')).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: undefined, cacheWriteTokens: undefined });
    expect(runtime.getSessionCost('agent-pan-1')?.totalCost).toBe(0.5);
  });
});
