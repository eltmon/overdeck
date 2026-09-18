import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/runtimes/index.js', () => ({
  getGlobalRegistry: () => ({
    get: (harness: string) => harness === 'prime-agent' ? {
      getSessionMetrics: () => ({
        lastActivity: new Date('2026-08-12T20:00:00.000Z'),
        tokenUsage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 },
        cost: { totalCost: 0.04 },
      }),
      getLastActivity: () => { throw new Error('must not rescan'); },
    } : harness === 'claude-code' ? {
      getLastActivity: () => { throw new Error('request route must not scan transcript directories'); },
      getTokenUsage: () => { throw new Error('request route must not parse transcripts'); },
      getSessionCost: () => { throw new Error('request route must not parse transcripts'); },
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

  it('projects identity only — and scans nothing — for a runtime without cached metrics', () => {
    // A runtime with no getSessionMetrics is left alone entirely. Calling
    // getLastActivity here would put claude-code's readdir + statSync sort on
    // the dashboard event loop once per agent row, for a field these payloads
    // did not carry before this projection existed.
    expect(projectRuntimeSession('agent-pan-1', 'claude-code')).toEqual({ harness: 'claude-code' });
  });
});
