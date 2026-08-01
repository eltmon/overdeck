import { describe, expect, it } from 'vitest';
import {
  acquireRadius,
  advanceFrostAccrual,
  aggregateTracePerSecond,
  bucketTraceRow,
  classifyOrb,
  computeLayout,
  dropRadius,
  fmtAge,
  frostFromIdleMinutes,
  modelGlyph,
  pickOrb,
  positionOrb,
  pruneTraceEvents,
  toolToFamily,
  traceTimeToX,
  type OrbState,
  type PositionableOrb,
  type TraceEvent,
} from '../model';

function orb(id: string, state: OrbState, stage = 'WORK'): PositionableOrb {
  return { id, state, stage, tx: 0, ty: 0 };
}

describe('Confluence model', () => {
  describe('layout and positioning', () => {
    it('keeps the mockup layout constants at 1680×945', () => {
      expect(computeLayout(1680, 945)).toEqual({
        padX: 26,
        riverTop: 92,
        riverBottom: 779,
        spectrumH: 54,
        doldrumsH: 64,
        shelfH: 34,
        colW: 1628 / 6,
        shelfY: 804,
        doldrumsY: 855,
        portalX: 1646,
        sunX: 64,
        sunY: 52,
      });
    });

    it('spreads stale orbs monotonically across two alternating rows', () => {
      const layout = computeLayout(1680, 945);
      const orbs = Array.from({ length: 8 }, (_, index) => orb(`PAN-${index + 1}`, 'stale'));

      for (const candidate of orbs) positionOrb(candidate, orbs, layout, orbs.length, 1);

      expect(orbs.map((candidate) => candidate.tx)).toEqual(
        [...orbs].map((candidate) => candidate.tx).sort((a, b) => a - b),
      );
      expect(new Set(orbs.map((candidate) => candidate.tx)).size).toBe(8);
      expect(orbs.map((candidate) => candidate.ty)).toEqual([
        layout.doldrumsY - 11,
        layout.doldrumsY + 13,
        layout.doldrumsY - 11,
        layout.doldrumsY + 13,
        layout.doldrumsY - 11,
        layout.doldrumsY + 13,
        layout.doldrumsY - 11,
        layout.doldrumsY + 13,
      ]);
    });

    it('clusters failed orbs to the left of the portal', () => {
      const layout = computeLayout(1680, 945);
      const orbs = ['PAN-1', 'PAN-2', 'PAN-3'].map((id) => orb(id, 'failed'));

      for (const candidate of orbs) positionOrb(candidate, orbs, layout, 1, 1);

      expect(orbs.every((candidate) => candidate.tx < layout.portalX)).toBe(true);
    });

    it('spreads shelf orbs deterministically along the shelf', () => {
      const layout = computeLayout(1680, 945);
      const orbs = ['PAN-1', 'PAN-2', 'PAN-3'].map((id) => orb(id, 'shelf'));

      for (const candidate of orbs) positionOrb(candidate, orbs, layout, 1, orbs.length);

      expect(orbs.map((candidate) => candidate.tx)).toEqual([166, 586, 1006]);
      expect(orbs.every((candidate) => candidate.ty === layout.shelfY)).toBe(true);
    });
  });

  describe('orb classification and picking', () => {
    const now = Date.parse('2026-08-01T12:00:00.000Z');
    const staleActivity = '2026-08-01T11:30:00.000Z';

    it('classifies with shelf > failed > stale > active precedence', () => {
      expect(classifyOrb({
        paused: true,
        mergeStatus: 'failed',
        lastActivity: staleActivity,
      }, now)).toBe('shelf');
      expect(classifyOrb({
        yieldedByScheduler: true,
        mergeStatus: 'failed',
        lastActivity: staleActivity,
      }, now)).toBe('shelf');
      expect(classifyOrb({ mergeStatus: 'failed', lastActivity: staleActivity }, now)).toBe('failed');
      expect(classifyOrb({ lastActivity: staleActivity }, now)).toBe('stale');
      expect(classifyOrb({ lastActivity: '2026-08-01T11:30:00.001Z' }, now)).toBe('active');
      expect(classifyOrb({}, now)).toBe('active');
    });

    it('uses the mockup acquire/drop radii and reverse draw order for picking', () => {
      const lower = { id: 'lower', x: 10, y: 10, radius: 5 };
      const upper = { id: 'upper', x: 10, y: 10, radius: 20 };

      expect(acquireRadius(lower)).toBe(18);
      expect(acquireRadius(upper)).toBe(38);
      expect(dropRadius(lower)).toBe(52);
      expect(dropRadius(upper)).toBe(84);
      expect(pickOrb([lower, upper], 10, 10)).toBe(upper);
      expect(pickOrb([lower, upper], 100, 100)).toBeNull();
    });
  });

  it('formats age boundaries exactly like the mockup', () => {
    expect(fmtAge(59)).toBe('59m');
    expect(fmtAge(60)).toBe('1h');
    expect(fmtAge(1440)).toBe('1d');
    expect(fmtAge(34551)).toBe('24d');
  });

  it('maps exact case-sensitive tool names to hook families', () => {
    expect(toolToFamily('Bash')).toBe('tool_exec');
    expect(toolToFamily('Edit')).toBe('tool_write');
    expect(toolToFamily('Read')).toBe('tool_read');
    expect(toolToFamily('WebFetch')).toBe('tool_web');
    expect(toolToFamily('Agent')).toBe('tool_agent');
    expect(toolToFamily('Stop')).toBe('lifecycle');
    expect(toolToFamily('SomeMCP')).toBe('lifecycle');
    expect(toolToFamily('bash')).toBe('lifecycle');
  });

  it('maps model families to their orb glyphs', () => {
    expect(modelGlyph('claude-sonnet-5')).toBe('S');
    expect(modelGlyph('gpt-5.6')).toBe('G');
    expect(modelGlyph('claude-opus-5')).toBe('O');
    expect(modelGlyph('claude-fable-5')).toBe('F');
    expect(modelGlyph('k3')).toBe('K');
    expect(modelGlyph('kimi-k2.5')).toBe('K');
    expect(modelGlyph(null)).toBeNull();
    expect(modelGlyph('')).toBeNull();
    expect(modelGlyph('unknown-model')).toBe('?');
  });

  it('accrues frost gradually and sinks only after the full-frost hold', () => {
    expect(frostFromIdleMinutes(8)).toBe(0);
    expect(frostFromIdleMinutes(21)).toBe(0.5);
    expect(frostFromIdleMinutes(34)).toBe(1);

    const fullyFrosted = advanceFrostAccrual(32, 5, 1);
    expect(fullyFrosted).toEqual({
      idleMinutes: 34,
      frost: 1,
      frostHoldSeconds: 6,
      sinkToDoldrums: false,
    });
    expect(advanceFrostAccrual(34, 6, 0.1).sinkToDoldrums).toBe(true);
    expect(advanceFrostAccrual(20, 3, 1).frostHoldSeconds).toBe(0);
  });

  describe('trace math', () => {
    const now = 100_000;
    const left = 128;
    const right = 728;

    it('maps the 60-second window edges to the trace bounds', () => {
      expect(traceTimeToX(now - 60_000, now, left, right)).toBe(left);
      expect(traceTimeToX(now, now, left, right)).toBe(right);
      expect(traceTimeToX(now - 30_000, now, left, right)).toBe((left + right) / 2);
    });

    it('stacks coincident same-hook events into 2 px row buckets', () => {
      const events: TraceEvent[] = [
        { name: 'PreToolUse', t: now - 5_000 },
        { name: 'PreToolUse', t: now - 5_000 },
        { name: 'Stop', t: now - 5_000 },
      ];
      const buckets = bucketTraceRow(events, 'PreToolUse', now, left, right);

      expect(Math.max(...buckets)).toBe(2);
      expect(buckets.filter(Boolean)).toHaveLength(1);
    });

    it('builds per-second buckets with an autoscale floor of five', () => {
      const events: TraceEvent[] = [
        { name: 'PreToolUse', t: now },
        { name: 'Stop', t: now - 1_000 },
        { name: 'Stop', t: now - 60_000 },
      ];
      const aggregate = aggregateTracePerSecond(events, now);

      expect(aggregate.buckets[59]).toBe(1);
      expect(aggregate.buckets[58]).toBe(1);
      expect(aggregate.buckets[0]).toBe(0);
      expect(aggregate.maxBucket).toBe(5);
    });

    it('prunes events older than 60 seconds while retaining the window edge', () => {
      const events: TraceEvent[] = [
        { name: 'old', t: now - 60_001 },
        { name: 'edge', t: now - 60_000 },
        { name: 'new', t: now },
      ];

      expect(pruneTraceEvents(events, now).map((event) => event.name)).toEqual(['edge', 'new']);
    });
  });
});
