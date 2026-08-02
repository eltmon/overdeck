import { render, screen } from '@testing-library/react';
import { WIRED_HOOK_NAMES } from '@overdeck/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BottomStrip,
  buildTraceFrame,
  traceTickAlpha,
  traceTickHeight,
} from '../BottomStrip';
import type { HookStreamEntry } from '../useConfluenceData';

function entry(
  hookName: string,
  ts: number,
  sequence = ts,
  source: HookStreamEntry['source'] = 'hook',
): HookStreamEntry {
  return {
    sequence,
    source,
    agentId: 'agent-pan-3447',
    issueId: 'PAN-3447',
    tool: 'Bash',
    hookName,
    family: 'lifecycle',
    ts,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Confluence bottom strip', () => {
  it('buckets real events onto matching channels and applies the burst formulas', () => {
    const now = 100_000;
    const frame = buildTraceFrame([
      entry('PreToolUse', now - 1_000),
      entry('PreToolUse', now - 1_000),
      entry('PostToolUse', now - 3_000),
      entry('SessionEnd', now - 1_000),
    ], now, 240);
    const preToolUse = frame.channels.find((channel) => channel.name === 'PreToolUse');
    const postToolUse = frame.channels.find((channel) => channel.name === 'PostToolUse');

    expect(preToolUse?.count).toBe(2);
    expect(preToolUse?.marks).toEqual([
      expect.objectContaining({ count: 2, alpha: traceTickAlpha(2) }),
    ]);
    expect(postToolUse?.count).toBe(1);
    expect(traceTickAlpha(2)).toBeCloseTo(.89);
    expect(traceTickHeight(2, 20)).toBeCloseTo(6.1);
    expect(traceTickHeight(2, 20)).toBeGreaterThan(traceTickHeight(1, 20));
    expect(frame.events.some((event) => event.hookName === 'SessionEnd')).toBe(false);
  });

  it('excludes lifecycle-only beats from hook trace channels and aggregates', () => {
    const frame = buildTraceFrame([
      entry('PreToolUse', 59_000),
      entry('Lifecycle', 59_500, 2, 'lifecycle'),
    ], 60_000, 240);

    expect(frame.events).toHaveLength(1);
    expect(frame.aggregateCurrent).toBe(0);
    expect(frame.aggregateBuckets.at(-2)).toBe(1);
    expect(frame.channels.reduce((total, channel) => total + channel.count, 0)).toBe(1);
  });

  it('reports per-window rates and dims zero-event channels by .38', () => {
    const frame = buildTraceFrame([entry('PreToolUse', 59_000)], 60_000, 240);
    const active = frame.channels.find((channel) => channel.name === 'PreToolUse');
    const idle = frame.channels.find((channel) => channel.name === 'PostToolUse');

    expect(active).toMatchObject({ count: 1, dim: 1 });
    expect(idle).toMatchObject({ count: 0, dim: .38, marks: [] });
  });

  it('builds real per-second aggregates, floors autoscale at five, and prunes after 60 seconds', () => {
    const entries = [
      entry('PreToolUse', 120_000),
      entry('PostToolUse', 120_000),
      entry('Stop', 118_900),
    ];
    const current = buildTraceFrame(entries, 120_000, 240);
    expect(current.aggregateCurrent).toBe(2);
    expect(current.aggregateBuckets.at(-2)).toBe(1);
    expect(current.aggregatePeak).toBe(5);

    const advanced = buildTraceFrame(entries, 180_001, 240);
    expect(advanced.events).toHaveLength(0);
    expect(advanced.aggregateCurrent).toBe(0);
    expect(advanced.aggregatePeak).toBe(5);
  });

  it('keeps trace channels aligned with contracts and renders live role counts', () => {
    const frame = buildTraceFrame([], 60_000, 240);
    expect(frame.channels.map((channel) => channel.name)).toEqual(WIRED_HOOK_NAMES);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<BottomStrip entries={[]} roleCounts={{ work: 7, review: 3, test: 2 }} />);
    const roles = screen.getByRole('contentinfo').querySelector('[aria-label="Agent role counts"]');
    expect(roles).toHaveTextContent('work7');
    expect(roles).toHaveTextContent('review3');
    expect(roles).toHaveTextContent('test2');
  });
});
