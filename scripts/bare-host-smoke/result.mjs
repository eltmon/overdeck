#!/usr/bin/env node
/**
 * PAN-5176/PAN-5361: the bare-host-smoke.sh verdict, moved out of the inline
 * `node -e` program in write_result() so the multi-window estimator can be
 * unit tested. No dependencies.
 *
 * Env contract (space-separated strings; empty string = none):
 *   R_BASELINE_WINDOWS  baseline window counts, one per window.
 *   R_IDLE_WINDOWS      idle window counts, one per window.
 *   R_IDLE_FROM         idle window start stamps, one per window.
 *   R_IDLE_TO           idle window end stamps, one per window.
 *   R_IDLE_TREE         Linux only: "startProcs:startTasks:endProcs:endTasks"
 *                       per idle window (an entry may be missing or empty
 *                       until WI-3 lands, or for a non-Linux OS).
 *   R_IDLE_SPAWNER_MS   --idle-spawner-ms value, or empty.
 *   R_SETUP_ERROR, R_PANUP_RC, R_PANUP_HEALTHY, R_PANUP_PASS, R_IDLE_BOOTED,
 *   R_IDLE_STAYED_UP, R_ENOENT_PASS, R_OS, R_SUBJECT, R_BUDGET, R_WINDOW,
 *   R_OUT, R_FORBIDDEN_FILE, R_ENOENT_FILE, R_TRACE_FILE, R_PATH_ENTRIES: as
 *   before.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const minOf = (values) => (values.length === 0 ? null : Math.min(...values));

/**
 * Count the traced child_process calls in `[from, to)` (or `[from, to]` when
 * `inclusiveTo`). A call is counted unless its only record is an "exit"
 * (already counted as a failed spawn). `pids` sums a weight of 2 per counted
 * call that went through a shell, 1 otherwise — a diagnostic upper bound on
 * how many PIDs that call could account for.
 */
export function summarizeSpawns(records, { from, to, pathEntries, inclusiveTo = false }) {
  const groups = new Map();
  let count = 0;
  let failed = 0;
  let spawnErrors = 0;
  let pids = 0;
  for (const rec of records) {
    if (!(rec.t >= from && (inclusiveTo ? rec.t <= to : rec.t < to))) continue;
    const g = groups.get(rec.program) || { program: rec.program, count: 0, failed: 0, errors: [] };
    if (rec.event !== 'exit') {
      count += 1;
      g.count += 1;
      pids += rec.shell ? 2 : 1;
    }
    if (rec.event === 'error' && rec.error !== 'exit 127') spawnErrors += 1;
    if (rec.error) {
      failed += 1;
      g.failed += 1;
      if (!g.errors.includes(rec.error)) g.errors.push(rec.error);
    }
    groups.set(rec.program, g);
  }
  // Every group, unsliced: mergeTop needs every program's full per-window
  // total before ranking, or a program split evenly across windows can drop
  // out of each window's own top slice and vanish from the merged top-10
  // even though its summed count would have led it.
  const top = [...groups.values()].sort((x, y) => y.count - x.count);
  const cost = count + (pathEntries - 1) * spawnErrors;
  return { count, failed, spawnErrors, cost, pids, top };
}

function mergeTop(tops) {
  const byProgram = new Map();
  for (const top of tops) {
    for (const g of top) {
      const existing = byProgram.get(g.program);
      if (existing) {
        existing.count += g.count;
        existing.failed += g.failed;
        for (const err of g.errors) if (!existing.errors.includes(err)) existing.errors.push(err);
      } else {
        byProgram.set(g.program, { program: g.program, count: g.count, failed: g.failed, errors: [...g.errors] });
      }
    }
  }
  return [...byProgram.values()].sort((x, y) => y.count - x.count).slice(0, 10);
}

/**
 * Decide the idle verdict. `idleWindows` is `[{ new, from, to, tree }]`,
 * `tree` is `{ start: { procs, tasks }, end: { procs, tasks } } | null`.
 * `baselineNew`/`idleNew` are the minima over their windows (so on macOS,
 * with one window per side, they equal today's single-window values).
 */
export function decideIdle({ os, budget, booted, stayedUp, baselineWindows, idleWindows, records, pathEntries, injectedSpawnerMs }) {
  const baselineNew = minOf(baselineWindows);
  const idleCounts = idleWindows.map((w) => w.new);
  const idleNew = minOf(idleCounts);
  const decidingWindow = idleNew === null ? null : idleCounts.indexOf(idleNew);
  const net = baselineNew === null || idleNew === null ? null : idleNew - baselineNew;
  const rule = os === 'darwin' ? 'traced-cost' : 'pid-net';

  let spawns = null;
  let resolvedIdleWindows = idleWindows;
  if (idleWindows.length > 0) {
    const perWindow = idleWindows.map((w) => summarizeSpawns(records, { from: w.from, to: w.to, pathEntries, inclusiveTo: os === 'darwin' }));
    resolvedIdleWindows = idleWindows.map((w, i) => ({ ...w, spawns: { count: perWindow[i].count, pids: perWindow[i].pids } }));
    spawns = {
      count: perWindow.reduce((a, s) => a + s.count, 0),
      failed: perWindow.reduce((a, s) => a + s.failed, 0),
      spawnErrors: perWindow.reduce((a, s) => a + s.spawnErrors, 0),
      pids: perWindow.reduce((a, s) => a + s.pids, 0),
      cost: perWindow.reduce((a, s) => a + s.cost, 0),
      top: mergeTop(perWindow.map((s) => s.top)),
    };
  }

  const value = rule === 'traced-cost' ? (spawns ? spawns.cost : null) : net;
  const pass = Boolean(booted) && Boolean(stayedUp) && value !== null && budget !== null && value <= budget;

  // Attribution is a heuristic diagnostic, never the verdict: a traced child
  // still alive at the end tree snapshot is not double counted (max, not
  // sum, of the two signals).
  let attribution = null;
  if (os !== 'darwin' && decidingWindow !== null) {
    const window = resolvedIdleWindows[decidingWindow];
    const tracedPids = window.spawns ? window.spawns.pids : 0;
    const growth = window.tree ? Math.max(0, window.tree.end.tasks - window.tree.start.tasks) : 0;
    const attributed = Math.max(tracedPids, growth);
    const excess = window.new - baselineNew;
    const source = 2 * attributed >= excess ? 'dashboard-tree' : 'unattributed';
    attribution = { window: decidingWindow, tracedPids, growth, attributed, excess, source };
  }

  return {
    booted: Boolean(booted),
    stayedUp: Boolean(stayedUp),
    baselineNew,
    idleNew,
    baselineWindows: [...baselineWindows],
    idleWindows: resolvedIdleWindows,
    decidingWindow,
    net,
    budget,
    rule,
    value,
    pass,
    spawns,
    attribution,
    injectedSpawnerMs: injectedSpawnerMs ?? null,
  };
}

const show = (value) => (value === null || value === undefined ? 'n/a' : String(value));
const verdict = (ok) => (ok ? 'PASS' : 'FAIL');

export function renderLines(result) {
  const { os, subject, setupError, panUp, idle, enoent } = result;
  const lines = [`bare-host smoke: ${setupError ? 'SETUP ERROR' : verdict(result.pass)} (${show(os)}, ${show(subject)})`];
  if (setupError) lines.push(`  setup error: ${setupError}`);
  lines.push(`  pan up:  ${verdict(panUp.pass)} rc=${show(panUp.rc)} healthy=${panUp.healthy} forbidden-tool lines=${panUp.forbiddenToolLines.length}`);
  for (const line of panUp.forbiddenToolLines) lines.push(`           ${line}`);
  lines.push(`  idle:    ${verdict(idle.pass)} booted=${idle.booted} stayedUp=${idle.stayedUp} rule=${idle.rule} value=${show(idle.value)} budget=${show(idle.budget)}`);
  const baselineList = idle.baselineWindows.join(',') || 'n/a';
  const idleList = idle.idleWindows.map((w) => w.new).join(',') || 'n/a';
  lines.push(
    `           PIDs: baseline=${baselineList} (min ${show(idle.baselineNew)}) idle=${idleList} (min ${show(idle.idleNew)}) net=${show(idle.net)} (${show(idle.netPerSec)}/s)` +
      (idle.rule === 'pid-net' ? '' : ' (reported, not asserted)'),
  );
  if (os !== 'darwin') {
    idle.idleWindows.forEach((w, i) => {
      const treePart = w.tree ? `; dashboard tree ${w.tree.start.procs}/${w.tree.start.tasks} -> ${w.tree.end.procs}/${w.tree.end.tasks}` : '';
      const spawnsPart = w.spawns ? `${w.spawns.count} traced calls (${w.spawns.pids} PIDs)` : 'no traced calls';
      lines.push(`           window ${i + 1}: ${show(w.new)} new${treePart}; ${spawnsPart}`);
    });
  }
  if (idle.spawns) {
    const windowsLabel = idle.idleWindows.length === 1
      ? 'the idle window'
      : `the ${idle.idleWindows.length} idle windows${idle.windowSecs !== null && idle.windowSecs !== undefined ? ` (${idle.windowSecs * idle.idleWindows.length} s)` : ''}`;
    lines.push(`           Overdeck child_process calls in ${windowsLabel}: ${idle.spawns.count} (${idle.spawns.failed} failed, ${idle.spawns.spawnErrors} failed to spawn), traced cost ${idle.spawns.cost}`);
    for (const g of idle.spawns.top) lines.push(`             ${g.count}x ${g.program}${g.failed ? ` (${g.failed} failed: ${g.errors.join(', ')})` : ''}`);
  }
  if (!idle.pass && os !== 'darwin' && idle.attribution) {
    const a = idle.attribution;
    lines.push(
      a.source === 'dashboard-tree'
        ? `  excess source: the dashboard process tree (attributed ${a.attributed} PIDs of ${a.excess} excess, window ${a.window + 1})`
        : `  excess source: not accounted for by the dashboard probes (traced calls, live tree tasks); the source is likely elsewhere on the host, but short-lived threads and non-Node grandchildren are invisible to the probes (attributed ${a.attributed} PIDs of ${a.excess} excess, window ${a.window + 1})`,
    );
  }
  lines.push(`  ENOENT:  ${verdict(enoent.pass)} repeats=${enoent.repeats.length}`);
  for (const r of enoent.repeats) lines.push(`           ${r.count}x ${r.key}`);
  return lines;
}

export function renderStepSummary(result) {
  const { os, subject, setupError, panUp, idle, enoent } = result;
  const windowSecs = idle.windowSecs ?? null;
  const md = [
    `### Bare-host smoke (${show(os)}): ${setupError ? 'setup error' : verdict(result.pass)}`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    `| pan up | ${verdict(panUp.pass)} | rc ${show(panUp.rc)}, healthy ${panUp.healthy}, ${panUp.forbiddenToolLines.length} forbidden-tool lines |`,
    `| Idle (${idle.rule}) | ${verdict(idle.pass)} | ${show(idle.value)} per ${show(windowSecs)} s, budget ${show(idle.budget)} |`,
    `| Idle new PIDs | ${idle.rule === 'pid-net' ? verdict(idle.pass) : 'info'} | net ${show(idle.net)} per ${show(windowSecs)} s (${show(idle.netPerSec)}/s), windows baseline=${idle.baselineWindows.join(',') || 'n/a'} idle=${idle.idleWindows.map((w) => w.new).join(',') || 'n/a'} |`,
    `| Overdeck spawns (idle windows) | info | ${idle.spawns ? `${idle.spawns.count} calls, ${idle.spawns.failed} failed${idle.spawns.top.length ? `; top: ${idle.spawns.top.slice(0, 5).map((g) => `${g.count}x ${g.program}${g.failed ? ' (failed)' : ''}`).join(', ')}` : ''}` : 'n/a'} |`,
    `| ENOENT repeats | ${verdict(enoent.pass)} | ${enoent.repeats.length} repeated |`,
    '',
    `Subject: \`${show(subject)}\`${setupError ? `. Setup error: ${setupError}` : ''}`,
    '',
  ];
  if (os !== 'darwin' && !idle.pass && idle.attribution) {
    md.push(`Excess source: ${idle.attribution.source === 'dashboard-tree' ? 'the dashboard process tree' : 'not accounted for by the dashboard probes'} (attributed ${idle.attribution.attributed} PIDs of ${idle.attribution.excess} excess).`, '');
  }
  return md;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const e = process.env;
  const readLines = (file) => {
    try {
      return readFileSync(file, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  const num = (value) => (value === undefined || value === '' ? null : Number(value));
  const bool = (value) => value === 'true';
  const parseNums = (value) => (value ? value.trim().split(/\s+/).filter(Boolean).map(Number) : []);

  const baselineWindows = parseNums(e.R_BASELINE_WINDOWS);
  const idleCounts = parseNums(e.R_IDLE_WINDOWS);
  const idleFroms = parseNums(e.R_IDLE_FROM);
  const idleTos = parseNums(e.R_IDLE_TO);
  const treeEntries = (e.R_IDLE_TREE || '').trim().split(/\s+/).filter(Boolean);
  const idleWindows = idleCounts.map((count, i) => {
    const parts = treeEntries[i] ? treeEntries[i].split(':').map(Number) : null;
    const tree = parts && parts.length === 4 && parts.every((n) => Number.isFinite(n))
      ? { start: { procs: parts[0], tasks: parts[1] }, end: { procs: parts[2], tasks: parts[3] } }
      : null;
    return { new: count, from: idleFroms[i], to: idleTos[i], tree };
  });
  const records = readLines(e.R_TRACE_FILE)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const repeats = readLines(e.R_ENOENT_FILE)
    .map((line) => {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      return m ? { key: m[2], count: Number(m[1]) } : null;
    })
    .filter((entry) => entry && entry.count >= 2);
  const setupError = e.R_SETUP_ERROR || null;
  const windowSecs = num(e.R_WINDOW);
  const budget = num(e.R_BUDGET);

  const idle = decideIdle({
    os: e.R_OS,
    budget,
    booted: bool(e.R_IDLE_BOOTED),
    stayedUp: bool(e.R_IDLE_STAYED_UP),
    baselineWindows,
    idleWindows,
    records,
    pathEntries: Number(e.R_PATH_ENTRIES),
    injectedSpawnerMs: num(e.R_IDLE_SPAWNER_MS),
  });
  idle.netPerSec = idle.net === null ? null : Math.round((idle.net / windowSecs) * 100) / 100;
  idle.windowsPerSide = Math.max(baselineWindows.length, idleWindows.length);
  idle.windowSecs = windowSecs;

  const result = {
    version: '1',
    os: e.R_OS || null,
    subject: e.R_SUBJECT || null,
    panUp: { rc: num(e.R_PANUP_RC), healthy: bool(e.R_PANUP_HEALTHY), forbiddenToolLines: readLines(e.R_FORBIDDEN_FILE), pass: bool(e.R_PANUP_PASS) },
    idle,
    enoent: { repeats, pass: bool(e.R_ENOENT_PASS) },
    pass: false,
    setupError,
  };
  result.pass = !setupError && result.panUp.pass && result.idle.pass && result.enoent.pass;

  if (e.R_OUT) {
    mkdirSync(dirname(e.R_OUT), { recursive: true });
    writeFileSync(e.R_OUT, `${JSON.stringify(result, null, 2)}\n`);
  }
  const lines = renderLines(result);
  lines.push(`  result:  ${e.R_OUT || 'not written'}`);
  console.log(lines.join('\n'));
  if (e.GITHUB_STEP_SUMMARY) {
    appendFileSync(e.GITHUB_STEP_SUMMARY, `${renderStepSummary(result).join('\n')}\n`);
  }
  process.exit(result.pass ? 0 : 1);
}
