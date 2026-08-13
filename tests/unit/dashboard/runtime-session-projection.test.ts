import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/runtimes/index.js', () => ({
  getGlobalRegistry: () => ({
    get: (harness: string) => harness === 'prime-agent' ? {
      getLastActivity: () => new Date('2026-08-12T20:00:00.000Z'),
      getTokenUsage: () => ({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 }),
      getSessionCost: () => ({ totalCost: 0.04 }),
    } : undefined,
  }),
}));

const { projectRuntimeSession } = await import('../../../src/dashboard/server/services/runtime-session-projection.js');

describe('dashboard runtime session projection', () => {
  it('projects Prime identity, activity, usage, and cost through the runtime adapter', () => {
    expect(projectRuntimeSession('agent-pan-3668', 'prime-agent')).toEqual({
      harness: 'prime-agent',
      lastActivity: '2026-08-12T20:00:00.000Z',
      tokenUsage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 },
      cost: 0.04,
    });
  });
});
