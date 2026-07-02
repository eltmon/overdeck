import { describe, expect, it, vi } from 'vitest';
import type { DeliveryResult } from '../delivery.js';
import {
  broadcastCommit,
  composeCommitFeedMessage,
  renderCommitFeedDiff,
} from '../tier-feed.js';
import type { ValidatedTieredExecutionFeedConfig } from '../tier-table.js';

const TIERS = [
  { tierName: 'cheap', agentId: 'agent-pan-1-slot-1' },
  { tierName: 'standard', agentId: 'agent-pan-1-slot-2' },
  { tierName: 'frontier', agentId: 'agent-pan-1-slot-3' },
];

function spies() {
  const deliveries: Array<{ agentId: string; message: string; caller?: string }> = [];
  const metrics: Parameters<NonNullable<Parameters<typeof broadcastCommit>[0]['recordDelivery']>>[0][] = [];
  const deliver = vi.fn(async (agentId: string, message: string, caller?: string): Promise<DeliveryResult> => {
    deliveries.push({ agentId, message, caller });
    return { ok: true, path: 'supervisor' };
  });
  const gitShow = vi.fn(async () => 'commit abc123\n\ndiff --git a/foo.ts b/foo.ts\n+added line\n');
  const recordDelivery = vi.fn(async (metric: (typeof metrics)[number]) => {
    metrics.push(metric);
  });
  return { deliver, gitShow, deliveries, recordDelivery, metrics };
}

function feedConfig(overrides: Partial<ValidatedTieredExecutionFeedConfig> = {}): ValidatedTieredExecutionFeedConfig {
  return {
    callouts: 'off',
    exclude: [],
    exclude_subjects: [],
    max_diff_bytes: null,
    ...overrides,
  };
}

describe('broadcastCommit', () => {
  it('sends the commit diff to every standing tier agent via the delivery seam', async () => {
    const { deliver, gitShow, deliveries, recordDelivery } = spies();

    await broadcastCommit({
      workspace: '/ws',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: TIERS,
      deliver,
      gitShow,
      recordDelivery,
    });

    expect(gitShow).toHaveBeenCalledWith('/ws', 'abc123');
    expect(deliveries.map((d) => d.agentId)).toEqual(TIERS.map((t) => t.agentId));
    for (const delivery of deliveries) {
      expect(delivery.message).toContain('diff --git a/foo.ts b/foo.ts');
      expect(delivery.message).toContain('Bead: my bead');
      expect(delivery.caller).toBe('tier-feed:broadcastCommit');
    }
  });

  it('sends exactly N deliveries for N standing tiers — everyone hears everything', async () => {
    const { deliver, gitShow, recordDelivery } = spies();

    const results = await broadcastCommit({
      workspace: '/ws',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: TIERS,
      deliver,
      gitShow,
      recordDelivery,
    });

    expect(deliver).toHaveBeenCalledTimes(TIERS.length);
    expect(results).toHaveLength(TIERS.length);
    expect(results.map((r) => r.tierName)).toEqual(['cheap', 'standard', 'frontier']);
  });

  it('marks every feed message ingestion-only, instructing the recipient not to respond', async () => {
    const { deliver, gitShow, deliveries, recordDelivery } = spies();

    await broadcastCommit({
      workspace: '/ws',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: TIERS,
      deliver,
      gitShow,
      recordDelivery,
    });

    for (const delivery of deliveries) {
      expect(delivery.message).toContain('ingestion-only');
      expect(delivery.message).toContain('Do NOT respond');
    }
  });

  it('keeps delivering to remaining tiers when one delivery throws', async () => {
    const { gitShow, recordDelivery } = spies();
    const deliver = vi.fn(async (agentId: string): Promise<DeliveryResult> => {
      if (agentId === 'agent-pan-1-slot-2') throw new Error('session gone');
      return { ok: true, path: 'supervisor' };
    });

    const results = await broadcastCommit({
      workspace: '/ws',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: TIERS,
      deliver,
      gitShow,
      recordDelivery,
    });

    expect(results).toHaveLength(3);
    expect(results[1].result.ok).toBe(false);
    expect(results[1].result.failure).toBe('session gone');
    expect(results[0].result.ok).toBe(true);
    expect(results[2].result.ok).toBe(true);
  });

  it('composes deterministic messages so replay reconstructs the identical feed', () => {
    const first = composeCommitFeedMessage('abc123', 'my bead', 'diff-body\n');
    const second = composeCommitFeedMessage('abc123', 'my bead', 'diff-body\n');
    expect(first).toBe(second);
  });

  it('preserves the pre-callout feed message byte-for-byte when callouts are off', () => {
    expect(composeCommitFeedMessage('abc123', 'my bead', 'diff-body\n')).toBe([
      '# Commit feed (ingestion-only): abc123',
      '',
      'Bead: my bead',
      '',
      'This is an ingestion-only feed delivery. Read the diff below to stay',
      'current with work landing on this issue. Do NOT respond to this message,',
      'do NOT take any action, and do NOT produce output — wait for your next',
      'dispatch.',
      '',
      '```diff',
      'diff-body',
      '```',
    ].join('\n'));
  });

  it('adds the call-out clause for notify policy deliveries', async () => {
    const { deliver, gitShow, deliveries, recordDelivery } = spies();

    await broadcastCommit({
      workspace: '/ws',
      issueId: 'PAN-1',
      apiUrl: 'http://api.test',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: [TIERS[0]],
      feedConfig: feedConfig({ callouts: 'notify' }),
      deliver,
      gitShow,
      recordDelivery,
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].message).toMatch(/at\s+most one call-out/);
    expect(deliveries[0].message).toContain('http://api.test/api/tiered/callouts');
    expect(deliveries[0].message).toContain(
      'Do not fix it yourself. Do not edit files. A call-out is a flag, not a task.',
    );
    expect(deliveries[0].message).toContain(
      `"issueId":"PAN-1","sha":"abc123","tierName":"cheap","agentId":"agent-pan-1-slot-1"`,
    );
  });

  it('records timestamped token metrics for every feed delivery', async () => {
    const { deliver, gitShow, recordDelivery, metrics } = spies();

    await broadcastCommit({
      workspace: '/ws',
      issueId: 'PAN-1',
      sha: 'abc123',
      beadTitle: 'my bead',
      tiers: TIERS,
      deliver,
      gitShow,
      recordDelivery,
      now: () => new Date('2026-07-02T12:00:00.000Z'),
    });

    expect(recordDelivery).toHaveBeenCalledTimes(TIERS.length);
    expect(metrics.map(metric => metric.agentId)).toEqual(TIERS.map(tier => tier.agentId));
    for (const metric of metrics) {
      expect(metric.ts).toBe('2026-07-02T12:00:00.000Z');
      expect(metric.issueId).toBe('PAN-1');
      expect(metric.sha).toBe('abc123');
      expect(metric.tokenCount).toBeGreaterThan(0);
      expect(metric.result.ok).toBe(true);
    }
  });

  it('skips excluded commit subjects before rendering or delivery', async () => {
    const { deliver, gitShow, recordDelivery } = spies();

    const results = await broadcastCommit({
      workspace: '/ws',
      sha: 'abc123',
      beadTitle: 'state update',
      commitSubject: 'chore(beads): close bead',
      tiers: TIERS,
      feedConfig: feedConfig({ exclude_subjects: ['chore(beads):'] }),
      deliver,
      gitShow,
      recordDelivery,
    });

    expect(results).toEqual([]);
    expect(gitShow).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(recordDelivery).not.toHaveBeenCalled();
  });
});

describe('renderCommitFeedDiff', () => {
  it('uses native exclude pathspecs so excluded files are absent from the rendered message', async () => {
    const gitShow = vi.fn(async (_workspace: string, _sha: string, args: string[]) => {
      expect(args).toEqual(['--', '.', ':(exclude)bun.lock']);
      return 'commit abc123\n\ndiff --git a/src/x.ts b/src/x.ts\n+kept\n';
    });

    const diff = await renderCommitFeedDiff('/ws', 'abc123', feedConfig({
      exclude: ['bun.lock'],
    }), { gitShow });
    const message = composeCommitFeedMessage('abc123', 'bead', diff);

    expect(message).toContain('diff --git a/src/x.ts b/src/x.ts');
    expect(message).not.toContain('bun.lock');
  });

  it('returns raw git show output byte-for-byte when feed knobs are at defaults', async () => {
    const raw = 'commit abc123\n\ndiff --git a/foo.ts b/foo.ts\n+added\n';
    const gitShow = vi.fn(async () => raw);

    await expect(renderCommitFeedDiff('/ws', 'abc123', feedConfig(), { gitShow })).resolves.toBe(raw);
    expect(gitShow).toHaveBeenCalledWith('/ws', 'abc123', []);
  });

  it('uses git show --stat plus an explicit truncation note when max_diff_bytes is exceeded', async () => {
    const gitShow = vi.fn(async (_workspace: string, _sha: string, args: string[]) => {
      if (args.includes('--stat')) return 'commit abc123\n\n src/x.ts | 200 +++++\n';
      return 'commit abc123\n\n' + 'x'.repeat(100);
    });

    const diff = await renderCommitFeedDiff('/ws', 'abc123', feedConfig({
      max_diff_bytes: 40,
    }), { gitShow });

    expect(diff).toContain('src/x.ts | 200 +++++');
    expect(diff).toContain('tiered_execution.feed.max_diff_bytes');
    expect(diff).toContain('bytes exceeded 40 bytes');
    expect(gitShow).toHaveBeenLastCalledWith('/ws', 'abc123', ['--stat']);
  });
});
