import { describe, expect, it } from 'vitest';

import { effortChipTitle, resolveEffortChip } from '../effortChip';

describe('resolveEffortChip', () => {
  it.each([
    [
      'observed differs from the resolution → terminal',
      { resolved: { effort: 'high', source: 'default' as const }, observed: 'low' },
      { level: 'low', source: 'terminal', observed: true },
    ],
    [
      'observed matches the resolution',
      { resolved: { effort: 'high', source: 'default' as const }, observed: 'high' },
      { level: 'high', source: 'default', observed: true },
    ],
    [
      'resolution only',
      { resolved: { effort: 'medium', source: 'explicit' as const }, observed: null },
      { level: 'medium', source: 'explicit', observed: false },
    ],
    [
      'invalid observed value is ignored',
      { resolved: { effort: 'high', source: 'role' as const }, observed: 'auto' },
      { level: 'high', source: 'role', observed: false },
    ],
    [
      'observed only',
      { resolved: null, observed: 'max' },
      { level: 'max', source: null, observed: true },
    ],
    [
      'invalid resolution falls back to the observed level',
      { resolved: { effort: 'off', source: 'explicit' as const }, observed: 'low' },
      { level: 'low', source: null, observed: true },
    ],
    ['nothing known', { resolved: null, observed: undefined }, null],
  ])('%s', (_name, input, expected) => {
    expect(resolveEffortChip(input)).toEqual(expected);
  });
});

describe('effortChipTitle', () => {
  it('describes an observed level', () => {
    expect(effortChipTitle({ level: 'high', source: 'default', observed: true }, { liveChangeEnabled: false, harness: 'codex' }))
      .toBe('Observed in the session transcript.');
  });

  it('describes a launch value that is not yet observed', () => {
    expect(effortChipTitle({ level: 'high', source: 'default', observed: false }, { liveChangeEnabled: false, harness: 'codex' }))
      .toBe('Launch value (default); not yet observed in the session transcript.');
  });

  it('describes a native-terminal change', () => {
    expect(effortChipTitle({ level: 'low', source: 'terminal', observed: true }, { liveChangeEnabled: false, harness: 'claude-code' }))
      .toBe('Changed in the native terminal; observed in the session transcript.');
  });

  it('adds the /effort and settings.json note for a live claude-code session', () => {
    const title = effortChipTitle({ level: 'high', source: 'explicit', observed: true }, { liveChangeEnabled: true, harness: 'claude-code' });
    expect(title).toContain('Picking a level sends /effort to the session.');
    expect(title).toContain('saves low–xhigh as your default');
  });
});
