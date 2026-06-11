/**
 * Tests for `paneTreeHasHarnessProcess` — the process-tree walk behind
 * `isHarnessProcessAlive`. Origin: PAN-1769 — the previous implementation
 * trusted `#{pane_current_command}`, but launcher scripts run the harness
 * without job control, so the pane's foreground process group stays the
 * launcher shell and tmux reports `bash` for a live
 * bash → node (pty-supervisor) → claude tree. Every supervisor-wrapped
 * conversation was corpse-marked "ended" ~37s after spawn (conv 2701/2707,
 * 2026-06-11), which is also what showed the user a live agent as "stopped".
 */

import { describe, it, expect } from 'vitest';
import { paneTreeHasHarnessProcess } from '../../src/lib/tmux.js';

function table(rows: Array<[pid: number, ppid: number, comm: string]>): string {
  return rows.map(([pid, ppid, comm]) => `${pid}  ${ppid}  ${comm}`).join('\n');
}

describe('paneTreeHasHarnessProcess', () => {
  it('reports alive for a supervisor-wrapped claude session (bash → node → claude)', () => {
    const ps = table([
      [100, 1, 'bash'],
      [110, 100, 'node'],
      [120, 110, 'claude'],
    ]);
    expect(paneTreeHasHarnessProcess([100], ps)).toBe(true);
  });

  it('reports dead for a keep-alive corpse (bash → sleep)', () => {
    const ps = table([
      [100, 1, 'bash'],
      [130, 100, 'sleep'],
    ]);
    expect(paneTreeHasHarnessProcess([100], ps)).toBe(false);
  });

  it('reports dead when the pane shell is between keep-alive iterations (bash only)', () => {
    const ps = table([[100, 1, 'bash']]);
    expect(paneTreeHasHarnessProcess([100], ps)).toBe(false);
  });

  it('reports dead when the pane pid is missing from the process table', () => {
    const ps = table([[999, 1, 'node']]);
    expect(paneTreeHasHarnessProcess([100], ps)).toBe(false);
  });

  it('reports alive when the pane process itself is the harness', () => {
    const ps = table([[100, 1, 'claude']]);
    expect(paneTreeHasHarnessProcess([100], ps)).toBe(true);
  });

  it('walks deep trees and tolerates comm values containing spaces', () => {
    const ps = table([
      [100, 1, 'bash'],
      [110, 100, 'sh'],
      [120, 110, 'npm exec @playw'],
    ]);
    expect(paneTreeHasHarnessProcess([100], ps)).toBe(true);
  });

  it('handles multiple pane pids and pid cycles without hanging', () => {
    const ps = table([
      [100, 200, 'bash'],
      [200, 100, 'bash'],
      [210, 200, 'sleep'],
    ]);
    expect(paneTreeHasHarnessProcess([100, 200], ps)).toBe(false);
  });
});
