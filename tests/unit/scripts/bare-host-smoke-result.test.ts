import { describe, expect, it } from 'vitest';
import { decideIdle, renderLines, summarizeSpawns } from '../../../scripts/bare-host-smoke/result.mjs';

type Rec = { t: number; event: string; program: string; error?: string; shell?: boolean };

function rec(t: number, program: string, opts: Partial<Rec> = {}): Rec {
  return { t, event: 'spawn', program, ...opts };
}

function window(n: number, from: number, to: number, tree: { start: { procs: number; tasks: number }; end: { procs: number; tasks: number } } | null = null) {
  return { new: n, from, to, tree };
}

const linuxArgs = (overrides: Record<string, unknown> = {}) => ({
  os: 'linux',
  budget: 30,
  booted: true,
  stayedUp: true,
  records: [] as Rec[],
  pathEntries: 6,
  injectedSpawnerMs: null,
  ...overrides,
});

describe('decideIdle (Linux pid-net, min-of-N)', () => {
  it('one +65 burst in one baseline window leaves the Linux net unchanged', () => {
    const r = decideIdle(linuxArgs({
      baselineWindows: [7, 72, 6],
      idleWindows: [window(13, 0, 30000), window(12, 30000, 60000), window(14, 60000, 90000)],
    }));
    expect(r.net).toBe(6);
    expect(r.pass).toBe(true);
  });

  it('one +65 burst in one idle window leaves the Linux net unchanged', () => {
    const r = decideIdle(linuxArgs({
      baselineWindows: [7, 8, 6],
      idleWindows: [window(13, 0, 30000), window(77, 30000, 60000), window(12, 60000, 90000)],
    }));
    expect(r.net).toBe(6);
    expect(r.pass).toBe(true);
  });

  it('a burst on each side at once leaves the Linux net unchanged', () => {
    const r = decideIdle(linuxArgs({
      baselineWindows: [7, 72, 6],
      idleWindows: [window(13, 0, 30000), window(77, 30000, 60000), window(12, 60000, 90000)],
    }));
    expect(r.net).toBe(6);
    expect(r.pass).toBe(true);
  });

  it('a steady +40 in every idle window fails pid-net', () => {
    const r = decideIdle(linuxArgs({
      baselineWindows: [6, 6, 6],
      idleWindows: [window(46, 0, 30000), window(46, 30000, 60000), window(46, 60000, 90000)],
    }));
    expect(r.rule).toBe('pid-net');
    expect(r.value).toBe(40);
    expect(r.pass).toBe(false);
  });

  it('matches result-module.ac2: idle [47,46,48] baseline [7,8,6] -> value 40, pass false', () => {
    const r = decideIdle(linuxArgs({
      baselineWindows: [7, 8, 6],
      idleWindows: [window(47, 0, 30000), window(46, 30000, 60000), window(48, 60000, 90000)],
    }));
    expect(r.rule).toBe('pid-net');
    expect(r.value).toBe(40);
    expect(r.pass).toBe(false);
  });

  it('a burst on the unique minimum window moves the net by at most the window spread', () => {
    const base = { baselineWindows: [6, 8, 10] };
    const a = decideIdle(linuxArgs({ ...base, idleWindows: [window(36, 0, 30000), window(37, 30000, 60000), window(38, 60000, 90000)] }));
    expect(a.net).toBe(30);
    const b = decideIdle(linuxArgs({ ...base, idleWindows: [window(101, 0, 30000), window(37, 30000, 60000), window(38, 60000, 90000)] }));
    expect(b.net).toBe(31);
  });
});

describe('decideIdle (macOS traced-cost, unchanged)', () => {
  it('darwin with one window per side keeps traced-cost and the single-window net', () => {
    const records: Rec[] = [
      ...Array.from({ length: 20 }, (_, i) => rec(1000 + i, 'claude')),
      rec(1010, 'tmux', { event: 'error', error: 'ENOENT' }),
    ];
    const r = decideIdle({
      os: 'darwin',
      budget: 30,
      booted: true,
      stayedUp: true,
      baselineWindows: [8],
      idleWindows: [window(25, 0, 2000)],
      records,
      pathEntries: 6,
      injectedSpawnerMs: null,
    });
    expect(r.rule).toBe('traced-cost');
    // 21 counted calls (the error record also counts as a call) + 5 * 1 spawnError = 26.
    expect(r.spawns?.count).toBe(21);
    expect(r.spawns?.spawnErrors).toBe(1);
    expect(r.spawns?.cost).toBe(26);
    expect(r.net).toBe(25 - 8);
    expect(r.value).toBe(r.spawns?.cost ?? null);
  });
});

describe('summarizeSpawns', () => {
  it('weighs shell calls 2 in pids but leaves cost unchanged', () => {
    const records: Rec[] = [rec(10, 'npm', { shell: true }), rec(11, 'npx', { shell: true }), rec(12, 'node')];
    const s = summarizeSpawns(records, { from: 0, to: 100, pathEntries: 6, inclusiveTo: false });
    expect(s.count).toBe(3);
    expect(s.pids).toBe(5);
    expect(s.cost).toBe(3);
  });

  it('half-open Linux bounds put a record at to_k into window k+1 only', () => {
    const records: Rec[] = [rec(30000, 'node')];
    const w0 = summarizeSpawns(records, { from: 0, to: 30000, pathEntries: 6, inclusiveTo: false });
    const w1 = summarizeSpawns(records, { from: 30000, to: 60000, pathEntries: 6, inclusiveTo: false });
    expect(w0.count).toBe(0);
    expect(w1.count).toBe(1);
  });
});

describe('FR-6 attribution', () => {
  it('attribution names the dashboard tree for a steady traced spawner (60 direct calls)', () => {
    const records: Rec[] = Array.from({ length: 60 }, (_, i) => rec(i * 400, 'true'));
    const r = decideIdle(linuxArgs({
      baselineWindows: [6, 6, 6],
      idleWindows: [window(66, 0, 30000), window(70, 30000, 60000), window(72, 60000, 90000)],
      records,
    }));
    expect(r.attribution?.tracedPids).toBe(60);
    expect(r.attribution?.excess).toBe(60);
    expect(r.attribution?.source).toBe('dashboard-tree');
  });

  it('attribution reports unattributed for a host burst with the standard 6 calls, excess 38 (result-module.ac4)', () => {
    const records: Rec[] = Array.from({ length: 6 }, (_, i) => rec(i * 1000, 'node'));
    const r = decideIdle(linuxArgs({
      baselineWindows: [6, 6, 6],
      idleWindows: [window(44, 0, 30000), window(50, 30000, 60000), window(52, 60000, 90000)],
      records,
    }));
    expect(r.attribution?.tracedPids).toBe(6);
    expect(r.attribution?.excess).toBe(38);
    expect(r.attribution?.source).toBe('unattributed');
  });

  it('a traced child alive at the end snapshot is not counted twice', () => {
    const records: Rec[] = Array.from({ length: 10 }, (_, i) => rec(i * 1000, 'node'));
    const r = decideIdle(linuxArgs({
      baselineWindows: [6, 6, 6],
      idleWindows: [
        window(46, 0, 30000, { start: { procs: 3, tasks: 20 }, end: { procs: 3, tasks: 30 } }),
        window(50, 30000, 60000),
        window(52, 60000, 90000),
      ],
      records,
    }));
    expect(r.attribution?.tracedPids).toBe(10);
    expect(r.attribution?.growth).toBe(10);
    expect(r.attribution?.attributed).toBe(10);
    expect(r.attribution?.excess).toBe(40);
    expect(r.attribution?.source).toBe('unattributed');
  });
});

describe('no idle windows (boot failure or setup error)', () => {
  it('returns spawns null and pass false on linux, and renderLines prints n/a', () => {
    const r = decideIdle(linuxArgs({ baselineWindows: [7, 8, 6], idleWindows: [] }));
    expect(r.spawns).toBeNull();
    expect(r.idleNew).toBeNull();
    expect(r.net).toBeNull();
    expect(r.value).toBeNull();
    expect(r.decidingWindow).toBeNull();
    expect(r.attribution).toBeNull();
    expect(r.pass).toBe(false);

    const result = {
      os: 'linux',
      subject: '@overdeck/core@0.86.0',
      setupError: null,
      panUp: { rc: 0, healthy: true, forbiddenToolLines: [], pass: true },
      idle: r,
      enoent: { repeats: [], pass: true },
      pass: false,
    };
    expect(() => renderLines(result)).not.toThrow();
    expect(renderLines(result).join('\n')).toContain('n/a');
  });

  it('returns spawns null and pass false on darwin, and renderLines prints n/a', () => {
    const r = decideIdle({
      os: 'darwin',
      budget: 30,
      booted: false,
      stayedUp: false,
      baselineWindows: [8],
      idleWindows: [],
      records: [],
      pathEntries: 6,
      injectedSpawnerMs: null,
    });
    expect(r.spawns).toBeNull();
    expect(r.value).toBeNull();
    expect(r.pass).toBe(false);

    const result = {
      os: 'darwin',
      subject: '@overdeck/core@0.86.0',
      setupError: 'dashboard never answered /api/health',
      panUp: { rc: 0, healthy: true, forbiddenToolLines: [], pass: true },
      idle: r,
      enoent: { repeats: [], pass: true },
      pass: false,
    };
    expect(() => renderLines(result)).not.toThrow();
    expect(renderLines(result).join('\n')).toContain('n/a');
  });
});
