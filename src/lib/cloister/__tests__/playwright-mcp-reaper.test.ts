import { describe, it, expect } from 'vitest';
import {
  parseProcTable,
  selectPlaywrightReapTargets,
  type ProcEntry,
} from '../playwright-mcp-reaper.js';

const HOUR = 3600;

function proc(pid: number, ppid: number, ageSeconds: number, args: string): ProcEntry {
  return { pid, ppid, ageSeconds, args };
}

/** A claude-owned playwright-mcp tree: claude → sh → node(mcp) → chrome(+child). */
function ownedTree(opts: { mcpAge?: number; browserAge?: number } = {}): ProcEntry[] {
  return [
    proc(100, 1, 10 * HOUR, '/home/u/.local/bin/claude --resume abc'),
    proc(200, 100, opts.mcpAge ?? HOUR, 'sh -c playwright-mcp --isolated'),
    proc(201, 200, opts.mcpAge ?? HOUR, 'node /home/u/.npm/_npx/abc/node_modules/.bin/playwright-mcp --isolated'),
    proc(300, 201, opts.browserAge ?? HOUR, '/opt/google/chrome/chrome --disable-field-trial-config --no-startup-window'),
    proc(301, 300, opts.browserAge ?? HOUR, '/opt/google/chrome/chrome --type=renderer --lang=en-US'),
  ];
}

describe('parseProcTable', () => {
  it('parses pid/ppid/etimes/args lines and skips garbage', () => {
    const out = parseProcTable(
      [
        '  100     1  3600 /usr/bin/node /a/.bin/playwright-mcp --isolated',
        'not a process line',
        '  200   100    60 /opt/google/chrome/chrome --type=renderer',
      ].join('\n'),
    );
    expect(out).toEqual([
      { pid: 100, ppid: 1, ageSeconds: 3600, args: '/usr/bin/node /a/.bin/playwright-mcp --isolated' },
      { pid: 200, ppid: 100, ageSeconds: 60, args: '/opt/google/chrome/chrome --type=renderer' },
    ]);
  });
});

describe('selectPlaywrightReapTargets', () => {
  it('leaves a freshly-owned tree alone', () => {
    const targets = selectPlaywrightReapTargets({ procs: ownedTree() });
    expect(targets.orphanTreePids).toEqual([]);
    expect(targets.staleBrowserPids).toEqual([]);
  });

  it('reaps the whole tree when the harness ancestor is gone', () => {
    // claude died: sh reparented to init.
    const procs = ownedTree().filter((p) => p.pid !== 100).map((p) =>
      p.pid === 200 ? { ...p, ppid: 1 } : p,
    );
    const targets = selectPlaywrightReapTargets({ procs });
    expect(targets.orphanTreePids.sort()).toEqual([201, 300, 301]);
    expect(targets.staleBrowserPids).toEqual([]);
  });

  it('does not reap a young orphan (restart race guard)', () => {
    const procs = ownedTree({ mcpAge: 60, browserAge: 60 })
      .filter((p) => p.pid !== 100)
      .map((p) => (p.pid === 200 ? { ...p, ppid: 1 } : p));
    const targets = selectPlaywrightReapTargets({ procs });
    expect(targets.orphanTreePids).toEqual([]);
  });

  it('reaps only the stale browser under a live owner', () => {
    const targets = selectPlaywrightReapTargets({
      procs: ownedTree({ browserAge: 3 * HOUR }),
    });
    expect(targets.orphanTreePids).toEqual([]);
    expect(targets.staleBrowserPids.sort()).toEqual([300, 301]);
  });

  it('recognizes a pty-supervisor-wrapped harness as a live owner', () => {
    const procs = [
      proc(100, 1, 10 * HOUR, 'node /repo/dist/pty-supervisor.js claude --resume abc'),
      ...ownedTree().filter((p) => p.pid !== 100),
    ];
    const targets = selectPlaywrightReapTargets({ procs });
    expect(targets.orphanTreePids).toEqual([]);
  });

  it('ignores non-playwright node processes entirely', () => {
    const procs = [
      proc(500, 1, 10 * HOUR, 'node /repo/dist/dashboard/server.js'),
      proc(501, 500, 10 * HOUR, '/opt/google/chrome/chrome --type=renderer'),
    ];
    const targets = selectPlaywrightReapTargets({ procs });
    expect(targets.orphanTreePids).toEqual([]);
    expect(targets.staleBrowserPids).toEqual([]);
  });
});
