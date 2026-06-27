import chalk from 'chalk';
import { describe, expect, it } from 'vitest';
import { formatRestartStatusLines } from '../status.js';

chalk.level = 0;

describe('formatRestartStatusLines', () => {
  it('renders pid and initiator on the restart line', () => {
    const lines = formatRestartStatusLines(
      {
        ts: '2026-05-17T15:00:00.000Z',
        trigger: 'pan reload',
        success: true,
        durationMs: 35000,
        attempts: 1,
        pid: 1733121,
        initiator: 'conv-20260610-573d',
      },
      [],
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('pid 1733121');
    expect(lines[0]).toContain('conv-20260610-573d');
  });

  it('emits a warning when concurrent writers are detected', () => {
    const baseTime = new Date('2026-05-17T15:00:00.000Z').getTime();
    const events = [
      {
        ts: new Date(baseTime).toISOString(),
        trigger: 'pan reload' as const,
        success: true,
        durationMs: 40100,
        attempts: 1,
        pid: 1733121,
        initiator: 'conv-a',
      },
      {
        ts: new Date(baseTime + 2600).toISOString(),
        trigger: 'pan reload' as const,
        success: true,
        durationMs: 35600,
        attempts: 1,
        pid: 2481245,
        initiator: 'conv-b',
      },
    ];

    const lines = formatRestartStatusLines(events[1], events);

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Concurrent restart writers detected');
    expect(lines[1]).toContain('pid 1733121 (conv-a)');
    expect(lines[1]).toContain('pid 2481245 (conv-b)');
  });

  it('preserves the single-line format when there are no concurrent writers', () => {
    const lines = formatRestartStatusLines(
      {
        ts: '2026-05-17T15:00:00.000Z',
        trigger: 'watchdog',
        success: true,
        durationMs: 1200,
        attempts: 1,
      },
      [],
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Last dashboard restart:/);
    expect(lines[0]).not.toContain('Concurrent');
  });
});
