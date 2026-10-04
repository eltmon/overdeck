import { describe, expect, it } from 'vitest';
import {
  CLOSE_OUT_PAUSE_REASON,
  ROLE_COLORS,
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
  shelfSlotWidth,
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
    const BAND_TEST_HEIGHTS = [600, 800, 1000] as const;

    it('keeps the shelf and doldrums bands disjoint', () => {
      for (const height of BAND_TEST_HEIGHTS) {
        const layout = computeLayout(1280, height);
        expect(layout.shelfBottom + 8).toBeLessThanOrEqual(layout.doldrumsTop);
        expect(layout.shelfTop).toBeGreaterThan(layout.riverBottom);
        expect(layout.doldrumsBottom).toBeLessThanOrEqual(height - 30);
      }
    });

    it('keeps every band text row inside its band', () => {
      for (const height of BAND_TEST_HEIGHTS) {
        const layout = computeLayout(1280, height);
        for (const y of [layout.shelfHeaderY, layout.shelfLabelY, layout.shelfReasonY]) {
          expect(y).toBeGreaterThanOrEqual(layout.shelfTop + 9);
          expect(y).toBeLessThanOrEqual(layout.shelfBottom - 2);
        }
        for (const y of [layout.doldrumsHeaderY, layout.doldrumsUpperLabelY, layout.doldrumsLowerLabelY]) {
          expect(y).toBeGreaterThanOrEqual(layout.doldrumsTop + 9);
          expect(y).toBeLessThanOrEqual(layout.doldrumsBottom - 2);
        }
        expect(layout.shelfLabelY).toBeLessThan(layout.shelfY - 14);
        expect(layout.shelfReasonY).toBeGreaterThan(layout.shelfY + 14);
        expect(layout.doldrumsUpperLabelY).toBeLessThan(layout.doldrumsUpperY - 14);
        expect(layout.doldrumsLowerLabelY).toBeGreaterThan(layout.doldrumsLowerY + 14);
      }
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
        layout.doldrumsUpperY,
        layout.doldrumsLowerY,
        layout.doldrumsUpperY,
        layout.doldrumsLowerY,
        layout.doldrumsUpperY,
        layout.doldrumsLowerY,
        layout.doldrumsUpperY,
        layout.doldrumsLowerY,
      ]);
    });

    it('clusters failed orbs to the left of the portal', () => {
      const layout = computeLayout(1680, 945);
      const orbs = ['PAN-1', 'PAN-2', 'PAN-3'].map((id) => orb(id, 'failed'));

      for (const candidate of orbs) positionOrb(candidate, orbs, layout, 1, 1);

      expect(orbs.every((candidate) => candidate.tx < layout.portalX)).toBe(true);
    });

    it('places a needs-you orb on the shelf row alongside shelf orbs (PAN-4383)', () => {
      const layout = computeLayout(1680, 945);
      const orbs = [orb('PAN-1', 'shelf'), orb('PAN-2', 'needs-you')];

      for (const candidate of orbs) positionOrb(candidate, orbs, layout, 1, orbs.length);

      expect(orbs[1].ty).toBe(layout.shelfY);
      expect(orbs[1].tx).toBeGreaterThan(orbs[0].tx);
    });

    it('spreads shelf orbs deterministically along the shelf', () => {
      const layout = computeLayout(1680, 945);
      const orbs = ['PAN-1', 'PAN-2', 'PAN-3'].map((id) => orb(id, 'shelf'));

      for (const candidate of orbs) positionOrb(candidate, orbs, layout, 1, orbs.length);

      expect(orbs.map((candidate) => candidate.tx)).toEqual([166, 880, 1594]);
      expect(orbs.every((candidate) => candidate.ty === layout.shelfY)).toBe(true);
    });

    it('keeps the last shelf orb and its fitted label inside the canvas at realistic canvas widths (PAN-4523 review)', () => {
      // 577: the river canvas's own width at a 1280px browser viewport once
      // the hook-bus panel and sidebar take their share (the committed
      // screenshot's measured width); 1280: a full-width synthetic canvas.
      for (const canvasWidth of [577, 1280]) {
        const layout = computeLayout(canvasWidth, 800);
        for (const shelfCount of [1, 2, 5, 8]) {
          const orbs = Array.from({ length: shelfCount }, (_, index) => orb(`PAN-${index}`, 'shelf'));
          for (const candidate of orbs) positionOrb(candidate, orbs, layout, 1, shelfCount);

          const lastTx = orbs[orbs.length - 1]!.tx;
          const slot = shelfSlotWidth(layout, shelfCount);
          expect(lastTx + slot / 2).toBeLessThanOrEqual(canvasWidth - layout.padX);
          expect(lastTx).toBeLessThanOrEqual(layout.portalX);
        }
      }
    });
  });

  describe('orb classification and picking', () => {
    const now = Date.parse('2026-08-01T12:00:00.000Z');
    const staleActivity = '2026-08-01T11:30:00.000Z';

    it('classifies with merged-close-out-exit > shelf > needs-you > failed > stale > active precedence', () => {
      expect(classifyOrb({
        paused: true,
        attention: 'stuck',
        lastActivity: staleActivity,
      }, now)).toBe('shelf');
      expect(classifyOrb({
        yieldedByScheduler: true,
        attention: 'stuck',
        lastActivity: staleActivity,
      }, now)).toBe('shelf');
      expect(classifyOrb({ attention: 'stuck', lastActivity: staleActivity }, now)).toBe('failed');
      expect(classifyOrb({ attention: 'api-error', lastActivity: staleActivity }, now)).toBe('failed');
      // PAN-4383: waiting on the operator is never idle, however long it waits.
      expect(classifyOrb({ attention: 'needs-you', lastActivity: staleActivity }, now)).toBe('needs-you');
      expect(classifyOrb({ lastActivity: staleActivity }, now)).toBe('stale');
      expect(classifyOrb({ lastActivity: '2026-08-01T11:30:00.001Z' }, now)).toBe('active');
      expect(classifyOrb({}, now)).toBe('active');
    });

    it('lets a merged issue paused only for close-out exit through MERGE (PAN-4523 D6)', () => {
      expect(classifyOrb({
        issueState: 'merged',
        paused: true,
        pausedReason: CLOSE_OUT_PAUSE_REASON,
        lastActivity: staleActivity,
      }, now)).toBe('active');
      expect(classifyOrb({
        issueState: 'merged',
        paused: true,
        pausedReason: 'RUN-92 safety hold: operator',
        lastActivity: staleActivity,
      }, now)).toBe('shelf');
      expect(classifyOrb({
        issueState: 'merged',
        yieldedByScheduler: true,
      }, now)).toBe('shelf');
      expect(classifyOrb({
        issueState: 'working',
        paused: true,
        pausedReason: CLOSE_OUT_PAUSE_REASON,
      }, now)).toBe('shelf');
      expect(classifyOrb({
        issueState: 'merged',
        lastActivity: staleActivity,
      }, now)).toBe('active');
    });

    it('keeps a needs-you orb out of the Doldrums after 17 hours, but a pause still shelves it (PAN-4383)', () => {
      const seventeenHoursAgo = now - 17 * 60 * 60 * 1000;
      expect(classifyOrb({ attention: 'needs-you', lastActivity: seventeenHoursAgo }, now)).toBe('needs-you');
      expect(classifyOrb({ paused: true, attention: 'needs-you', lastActivity: seventeenHoursAgo }, now)).toBe('shelf');
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

describe('ROLE_COLORS', () => {
  it('colors every agent role, including PAN-3920 workers', () => {
    for (const role of ['plan', 'work', 'worker', 'review', 'test', 'ship', 'flywheel', 'strike', 'sequencer', 'knowledge'] as const) {
      expect(ROLE_COLORS[role]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
