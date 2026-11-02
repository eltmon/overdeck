/**
 * PAN-4739: without a UTF-8 locale (Fly's exec shell sets no LANG) tmux 3.4
 * prints every tab in `-F` output as `_`, so the runtime census parsed no pane
 * and the lifecycle patrol ended a live conversation on every tick. The pane
 * readers that parse tab-separated records pass `-u` before the command.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[][],
  stdout: '',
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execFile = vi.fn((_cmd: string, args: string[], _opts: unknown, cb: (err: unknown, out: unknown) => void) => {
    h.calls.push(args);
    cb(null, { stdout: h.stdout, stderr: '' });
  });
  return { ...actual, execFile };
});
vi.mock('../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: () => ({ config: { tmux: { configMode: 'inherit-user' } } }),
  };
});

import { listAllPaneRecords, listPaneValues } from '../tmux.js';

/** The tmux global flags of a call: everything before the command name. */
function globalFlagsBefore(command: string): string[] {
  const call = h.calls.find((args) => args.includes(command));
  if (!call) throw new Error(`no tmux ${command} call`);
  return call.slice(0, call.indexOf(command));
}

beforeEach(() => {
  h.calls = [];
  h.stdout = '';
});

describe('tmux pane readers force a UTF-8 client (PAN-4739)', () => {
  it('the runtime census read passes -u, so tab-separated records survive a locale-less shell', async () => {
    h.stdout = 'conv-flap\t565\t0\t\n';

    const records = await Effect.runPromise(listAllPaneRecords());

    expect(globalFlagsBefore('list-panes')).toContain('-u');
    expect(records).toEqual([{ sessionName: 'conv-flap', panePid: 565, paneDead: false, paneDeadStatus: null }]);
  });

  it('the per-target pane reader passes -u', async () => {
    h.stdout = '565\t0\n';

    const values = await listPaneValues('conv-flap', '#{pane_pid}\t#{pane_dead}');

    expect(globalFlagsBefore('list-panes')).toContain('-u');
    expect(values).toEqual(['565\t0']);
  });
});
