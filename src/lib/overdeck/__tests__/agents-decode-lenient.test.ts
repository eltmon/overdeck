import { describe, expect, it, vi } from 'vitest';

import { decodeAgentRowsLenient } from '../agents.js';

// Mirrors the camelCase row shape drizzle returns from `select().from(agents)`:
// Date objects for timestamp_ms columns, booleans for boolean columns, null for
// absent nullable columns.
const validRow = {
  id: 'agent-pan-1-work',
  issueId: 'PAN-1',
  role: 'work',
  status: 'running',
  workspace: '/tmp/ws',
  sessionId: null,
  harness: 'claude-code',
  model: 'claude-opus-4-8',
  hostOverride: null,
  deliveryMethod: null,
  startedAt: null,
  lastResumeAt: null,
  stoppedByUser: null,
  kickoffDelivered: null,
  paused: null,
  pausedReason: null,
  troubled: null,
  channelsEnabled: null,
  consecutiveFailures: 0,
  firstFailureInRunAt: null,
  lastFailureNextRetryAt: null,
  updatedAt: new Date('2026-07-09T00:00:00.000Z'),
};

describe('decodeAgentRowsLenient (boot-critical list decode)', () => {
  it('skips a row whose role main does not know (e.g. a feature-branch role) instead of throwing', () => {
    // A feature-branch agent (PAN-2468 `knowledge`, which lives only on
    // feature/pan-2468) registers in the shared overdeck.db; main must not brick
    // boot decoding it.
    const knowledgeRow = { ...validRow, id: 'agent-pan-2468-knowledge', role: 'knowledge' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const decoded = decodeAgentRowsLenient([validRow, knowledgeRow]);

    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.id).toBe('agent-pan-1-work');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('agent-pan-2468-knowledge'),
    );
    warn.mockRestore();
  });

  it('decodes every row when all roles are valid', () => {
    const other = { ...validRow, id: 'agent-pan-2-review', role: 'review' };
    const decoded = decodeAgentRowsLenient([validRow, other]);
    expect(decoded.map((a) => a.id)).toEqual(['agent-pan-1-work', 'agent-pan-2-review']);
  });
});
