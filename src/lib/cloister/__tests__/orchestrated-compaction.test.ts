import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  COMPACTION_CONTINUE_MIN_SETTLE_MS,
  ORCHESTRATED_COMPACTION_CONTINUE_MESSAGE,
  deliverOrchestratedCompact,
  maybeContinueOrchestratedCompaction,
  orchestratedCompactionContinuations,
  scheduleOrchestratedCompactionContinuation,
} from '../orchestrated-compaction.js';

describe('orchestrated compaction continuation', () => {
  beforeEach(() => {
    orchestratedCompactionContinuations.clear();
  });

  it('continues once the compacted session returns to an idle prompt', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const requestedAt = Date.parse('2026-07-19T02:25:56.000Z');
    scheduleOrchestratedCompactionContinuation('agent-pan-2899', requestedAt);

    expect(await maybeContinueOrchestratedCompaction({
      sessionName: 'agent-pan-2899',
      tmuxOutput: 'Compacting conversation…',
      now: requestedAt + 1_000,
      send,
    })).toBe(false);

    expect(await maybeContinueOrchestratedCompaction({
      sessionName: 'agent-pan-2899',
      tmuxOutput: 'Context left until auto-compact: 99%\n❯',
      now: requestedAt + 2_000,
      send,
    })).toBe(true);
    expect(send).toHaveBeenCalledWith('agent-pan-2899', ORCHESTRATED_COMPACTION_CONTINUE_MESSAGE);
    expect(orchestratedCompactionContinuations.has('agent-pan-2899')).toBe(false);
  });

  it('uses a bounded settle delay when compaction finishes between patrols', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const requestedAt = Date.parse('2026-07-19T02:25:56.000Z');
    scheduleOrchestratedCompactionContinuation('agent-pan-2899', requestedAt);

    expect(await maybeContinueOrchestratedCompaction({
      sessionName: 'agent-pan-2899',
      tmuxOutput: '❯',
      now: requestedAt + COMPACTION_CONTINUE_MIN_SETTLE_MS - 1,
      send,
    })).toBe(false);

    expect(await maybeContinueOrchestratedCompaction({
      sessionName: 'agent-pan-2899',
      tmuxOutput: '❯',
      now: requestedAt + COMPACTION_CONTINUE_MIN_SETTLE_MS,
      send,
    })).toBe(true);
  });

  it('does not continue while the context overflow remains visible', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const requestedAt = Date.parse('2026-07-19T02:25:56.000Z');
    scheduleOrchestratedCompactionContinuation('agent-pan-2899', requestedAt);

    expect(await maybeContinueOrchestratedCompaction({
      sessionName: 'agent-pan-2899',
      tmuxOutput: 'API Error: 400 Your input exceeds the context window of this model.\n❯',
      now: requestedAt + COMPACTION_CONTINUE_MIN_SETTLE_MS,
      send,
    })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(orchestratedCompactionContinuations.has('agent-pan-2899')).toBe(true);
  });

  it('cancels the continuation when slash-command delivery fails', async () => {
    await expect(deliverOrchestratedCompact(
      'agent-pan-2899',
      () => Promise.reject(new Error('delivery failed')),
    )).rejects.toThrow('delivery failed');

    expect(orchestratedCompactionContinuations.has('agent-pan-2899')).toBe(false);
  });
});
