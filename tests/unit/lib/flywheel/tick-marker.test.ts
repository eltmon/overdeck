import { describe, expect, it } from 'vitest';

import {
  TICK_MARKER_PREFIX,
  findLastTick,
  formatTickMarker,
  parseTickMarker,
  type TickMarker,
} from '../../../../src/lib/flywheel/tick-marker.js';

const fixtures: TickMarker[] = [
  { tick: 3, pick: 'PAN-3964', phase: 'watch', inFlight: ['PAN-3964', 'PAN-3920'], needsYou: null },
  { tick: 0, pick: null, phase: 'idle', inFlight: [], needsYou: 'pipeline idle — nothing pickable' },
  { tick: 12, pick: 'MIN-7', phase: 'stopping', inFlight: ['MIN-7'], needsYou: 'merge PAN-1 when x=y holds' },
];

describe('tick marker (PAN-3964 FR-2)', () => {
  it.each(fixtures)('round-trips tick $tick', (fixture) => {
    const line = formatTickMarker(fixture);
    expect(line.startsWith(TICK_MARKER_PREFIX)).toBe(true);
    expect(parseTickMarker(line)).toEqual(fixture);
  });

  it('prints the exact shape the skill documents', () => {
    expect(formatTickMarker(fixtures[0]!)).toBe(
      'flywheel-tick: tick=3 pick=PAN-3964 phase=watch in-flight=PAN-3964,PAN-3920 needs-you=none',
    );
  });

  it('the last marker line wins', () => {
    const text = [
      'Oriented.',
      'flywheel-tick: tick=1 pick=PAN-1 phase=launch in-flight=PAN-1 needs-you=none',
      'more prose',
      'flywheel-tick: tick=2 pick=none phase=watch in-flight=none needs-you=none',
      'trailing prose',
    ].join('\n');
    expect(parseTickMarker(text)).toEqual({ tick: 2, pick: null, phase: 'watch', inFlight: [], needsYou: null });
  });

  it('maps `none` to null / empty', () => {
    const parsed = parseTickMarker('flywheel-tick: tick=4 pick=none phase=park in-flight=none needs-you=none');
    expect(parsed).toEqual({ tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: null });
  });

  it('parses an unknown phase as watch', () => {
    expect(parseTickMarker('flywheel-tick: tick=5 pick=none phase=dancing in-flight=none needs-you=none')?.phase).toBe('watch');
  });

  it('needs-you keeps spaces and `=` inside its value', () => {
    const parsed = parseTickMarker('flywheel-tick: tick=6 pick=PAN-2 phase=watch in-flight=PAN-2 needs-you=decide a=b or c = d');
    expect(parsed?.needsYou).toBe('decide a=b or c = d');
  });

  it('tolerates a backtick-wrapped line', () => {
    expect(parseTickMarker('`flywheel-tick: tick=7 pick=none phase=idle in-flight=none needs-you=none`')?.tick).toBe(7);
  });

  it('returns null without a marker or with a template placeholder tick', () => {
    expect(parseTickMarker('no marker here')).toBeNull();
    expect(parseTickMarker('print flywheel-tick: … phase=stopping, then end.')).toBeNull();
  });

  it('findLastTick reads assistant messages only, newest first', () => {
    const messages = [
      { role: 'assistant', text: 'flywheel-tick: tick=1 pick=PAN-1 phase=launch in-flight=PAN-1 needs-you=none', createdAt: '2026-09-23T10:00:00Z' },
      { role: 'assistant', text: 'working…', createdAt: '2026-09-23T10:01:00Z' },
      { role: 'user', text: 'flywheel-tick: tick=99 pick=none phase=stopping in-flight=none needs-you=none', createdAt: '2026-09-23T10:02:00Z' },
    ];
    expect(findLastTick(messages)).toEqual({
      tick: 1, pick: 'PAN-1', phase: 'launch', inFlight: ['PAN-1'], needsYou: null, at: '2026-09-23T10:00:00Z',
    });
    expect(findLastTick([])).toBeNull();
  });
});
