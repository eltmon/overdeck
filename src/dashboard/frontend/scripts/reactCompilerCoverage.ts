/**
 * React Compiler skip coverage (PAN-4561).
 *
 * The compiler leaves a component or hook uncompiled when it reports a
 * diagnostic for it, or when the source opts out with "use no memo". Builds
 * do not fail on that (panicThreshold 'none'), so this scan is the gate: it
 * compiles every frontend source file with the same oxc-transform-react
 * version and options the build uses (reactCompiler.ts) and counts skips per
 * file. scripts/react-compiler-skip-baseline.txt holds the shrink-only
 * per-file counts, and src/__tests__/reactCompilerCoverage.test.ts fails on
 * any file above its row or any stale row.
 *
 * CLI, from the repo root:
 *   npx tsx src/dashboard/frontend/scripts/reactCompilerCoverage.ts [--check|--update|--init]
 *   --check   (default) print violations and exit 1 on any
 *   --update  lower stale rows and drop resolved ones; never adds or raises a row
 *   --init    write the full current set (baseline creation only)
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { transformSync } from 'oxc-transform-react';

import { reactCompilerOptions } from '../reactCompiler';

export interface SkipCount {
  count: number;
  firstMessage: string | null;
}

export interface BaselineComparison {
  added: string[];
  raised: string[];
  stale: string[];
}

const OPT_OUT_DIRECTIVE = /['"]use no (?:memo|forget)['"]/g;
const SETUP_FILES = new Set(['src/test-setup.ts', 'src/canvas-setup.ts']);

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '..');
const repoRoot = path.resolve(frontendRoot, '../../..');

export const BASELINE_FILE = path.join(repoRoot, 'scripts', 'react-compiler-skip-baseline.txt');
export const FRONTEND_SRC = path.join(frontendRoot, 'src');

const BASELINE_HEADER = [
  '# React Compiler skip baseline (PAN-4561). Rows: <count> <path>. Count = compiler diagnostics + "use no memo" directives.',
  '# Shrink-only. Lower with: npx tsx src/dashboard/frontend/scripts/reactCompilerCoverage.ts --update',
];

/** `relPath` is relative to the frontend package root (`src/...`) or any root above it. */
export function isFrontendSourceFile(relPath: string): boolean {
  const normalized = relPath.split(path.sep).join('/');
  if (!/\.tsx?$/.test(normalized)) return false;
  if (normalized.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.[^/]+$/.test(normalized)) return false;
  const segments = normalized.split('/');
  if (segments.includes('__tests__') || segments.includes('test-utils')) return false;
  for (const setup of SETUP_FILES) {
    if (normalized === setup || normalized.endsWith(`/${setup}`)) return false;
  }
  return true;
}

export function skipCountForSource(filename: string, code: string): SkipCount {
  const result = transformSync(filename, code, {
    jsx: { runtime: 'automatic' },
    reactCompiler: { ...reactCompilerOptions, reportDiagnostics: true },
  });
  const directives = code.match(OPT_OUT_DIRECTIVE)?.length ?? 0;
  const count = result.errors.length + directives;
  let firstMessage: string | null = null;
  if (result.errors.length > 0) firstMessage = result.errors[0].message.split('\n')[0];
  else if (directives > 0) firstMessage = 'opt-out directive';
  return { count, firstMessage };
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir).sort()) {
    const absPath = path.join(dir, entry);
    if (statSync(absPath).isDirectory()) walk(absPath, out);
    else out.push(absPath);
  }
}

/** Keys are repo-root-relative paths (`src/dashboard/frontend/src/...`); only files with skips. */
export function scanFrontend(srcRoot: string): Map<string, SkipCount> {
  const files: string[] = [];
  walk(srcRoot, files);
  const result = new Map<string, SkipCount>();
  for (const absPath of files) {
    const relToSrcParent = path.relative(path.dirname(srcRoot), absPath);
    if (!isFrontendSourceFile(relToSrcParent)) continue;
    const code = readFileSync(absPath, 'utf8');
    const skip = skipCountForSource(absPath, code);
    if (skip.count > 0) result.set(path.relative(repoRoot, absPath).split(path.sep).join('/'), skip);
  }
  return result;
}

export function readBaseline(file: string): Map<string, number> {
  const rows = new Map<string, number>();
  if (!existsSync(file)) return rows;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const match = /^(\d+)\s+(.+)$/.exec(trimmed);
    if (!match) throw new Error(`Malformed baseline row in ${file}: ${line}`);
    rows.set(match[2], Number(match[1]));
  }
  return rows;
}

export function writeBaseline(file: string, rows: Map<string, number>): void {
  const body = [...rows.entries()]
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([p, count]) => `${count} ${p}`);
  writeFileSync(file, [...BASELINE_HEADER, ...body].join('\n') + '\n');
}

export function compareToBaseline(current: Map<string, SkipCount>, baseline: Map<string, number>): BaselineComparison {
  const added: string[] = [];
  const raised: string[] = [];
  const stale: string[] = [];
  for (const [p, { count }] of current) {
    const row = baseline.get(p);
    if (row === undefined) added.push(p);
    else if (count > row) raised.push(p);
  }
  for (const [p, row] of baseline) {
    const count = current.get(p)?.count ?? 0;
    if (row > count) stale.push(p);
  }
  return { added: added.sort(), raised: raised.sort(), stale: stale.sort() };
}

function describe(p: string, current: Map<string, SkipCount>, baseline: Map<string, number>): string {
  const skip = current.get(p);
  return `  ${p}: ${skip?.count ?? 0} skip(s), baseline ${baseline.get(p) ?? 'none'}${skip?.firstMessage ? ` (${skip.firstMessage})` : ''}`;
}

function main(argv: string[]): number {
  const mode = argv[0] ?? '--check';
  if (!['--check', '--update', '--init'].includes(mode)) {
    console.error(`Unknown mode ${mode}; use --check, --update or --init.`);
    return 2;
  }
  const current = scanFrontend(FRONTEND_SRC);
  if (mode === '--init') {
    writeBaseline(BASELINE_FILE, new Map([...current].map(([p, s]) => [p, s.count])));
    console.log(`Wrote ${current.size} rows to ${path.relative(repoRoot, BASELINE_FILE)}.`);
    return 0;
  }
  const baseline = readBaseline(BASELINE_FILE);
  const { added, raised, stale } = compareToBaseline(current, baseline);
  if (mode === '--update' && stale.length > 0) {
    const next = new Map(baseline);
    for (const p of stale) next.set(p, current.get(p)?.count ?? 0);
    writeBaseline(BASELINE_FILE, next);
    console.log(`Lowered ${stale.length} row(s) in ${path.relative(repoRoot, BASELINE_FILE)}.`);
  }
  const violations = [...added, ...raised];
  if (mode === '--check' && stale.length > 0) {
    console.error('Stale rows (run with --update to lower them):');
    for (const p of stale) console.error(describe(p, current, baseline));
  }
  if (violations.length > 0) {
    console.error('Files the React Compiler skips beyond the baseline. Fix the component (docs/DASHBOARD-ARCHITECTURE.md, React Compiler):');
    for (const p of violations) console.error(describe(p, current, baseline));
  }
  if (violations.length > 0) return 1;
  if (mode === '--check' && stale.length > 0) return 1;
  console.log(`React Compiler coverage OK: ${current.size} file(s) at or below baseline.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
