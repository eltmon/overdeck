import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-effect-facades.sh', import.meta.url);
const BASELINE_HEADER = [
  '# Effect façade ratchet baseline (PAN-3958). Rows: <shape> <count> <path>. Shapes: A=Promise façade,',
  '# B=sync façade, C=sync/async twin pair. Lower with: bash scripts/lint-effect-facades.sh --update',
];
// Stub audit: prints the rows the test supplies instead of scanning src/lib.
const STUB_AUDIT = "process.stdout.write(process.env.FAKE_ROWS ? `${process.env.FAKE_ROWS}\\n` : '');\n";

type GuardResult = { ok: boolean; output: string };

function makeTempGuard(baselineRows: string[] | null): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-effect-facades-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'lint-effect-facades.sh'), readFileSync(SCRIPT_SOURCE, 'utf-8'));
  writeFileSync(join(root, 'scripts', 'audit-effect-boundary.mjs'), STUB_AUDIT);
  if (baselineRows) {
    writeFileSync(baselinePath(root), `${[...BASELINE_HEADER, ...baselineRows].join('\n')}\n`);
  }
  return root;
}

function baselinePath(root: string): string {
  return join(root, 'scripts', 'effect-facades-baseline.txt');
}

function baselineRowsOf(root: string): string[] {
  return readFileSync(baselinePath(root), 'utf-8').split('\n').filter((line) => line && !line.startsWith('#'));
}

function runGuard(root: string, rows: string[], args: string[] = []): GuardResult {
  try {
    const output = execFileSync('bash', [join(root, 'scripts', 'lint-effect-facades.sh'), ...args], {
      cwd: root,
      encoding: 'utf-8',
      env: { ...process.env, FAKE_ROWS: rows.join('\n') },
    });
    return { ok: true, output };
  } catch (error: unknown) {
    const result = error as { stdout?: string; stderr?: string };
    return { ok: false, output: [result.stdout ?? '', result.stderr ?? ''].join('\n') };
  }
}

describe('lint-effect-facades.sh', () => {
  it('(a) passes when every count equals its baseline row', () => {
    const rows = ['A 3 src/lib/x.ts', 'B 2 src/lib/x.ts', 'C 1 src/lib/y.ts'];
    const root = makeTempGuard(rows);

    const result = runGuard(root, rows);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('Effect façade ratchet passed (A 3, B 2, C 1; none new)');
    expect(result.output).not.toContain('NEW:');
  });

  it('(b) fails and names the row when a module gains a façade', () => {
    const root = makeTempGuard(['A 3 src/lib/x.ts', 'B 2 src/lib/x.ts']);

    const result = runGuard(root, ['A 4 src/lib/x.ts', 'B 2 src/lib/x.ts']);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('NEW: A 4 src/lib/x.ts (baseline 3)');
    expect(result.output).not.toContain('NEW: B');
  });

  it('(c) fails on a module or shape absent from the baseline, comparing counts numerically', () => {
    const root = makeTempGuard(['A 11 src/lib/x.ts']);

    const result = runGuard(root, ['A 2 src/lib/x.ts', 'C 1 src/lib/x.ts', 'B 1 src/lib/new.ts']);

    expect(result.ok).toBe(false);
    expect(result.output).toContain('NEW: C 1 src/lib/x.ts (baseline 0)');
    expect(result.output).toContain('NEW: B 1 src/lib/new.ts (baseline 0)');
    expect(result.output).not.toContain('NEW: A');
  });

  it('passes a lowered count and suggests --update without rewriting the baseline', () => {
    const root = makeTempGuard(['A 3 src/lib/x.ts']);
    const before = readFileSync(baselinePath(root), 'utf-8');

    const result = runGuard(root, ['A 1 src/lib/x.ts']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('lint-effect-facades.sh --update');
    expect(readFileSync(baselinePath(root), 'utf-8')).toBe(before);
  });

  it('(d) --update lowers a row and drops a row whose count went to zero', () => {
    const root = makeTempGuard(['A 3 src/lib/x.ts', 'B 2 src/lib/gone.ts', 'C 1 src/lib/y.ts']);

    const result = runGuard(root, ['A 2 src/lib/x.ts', 'C 1 src/lib/y.ts'], ['--update']);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('A 3, B 2, C 1 → A 2, B 0, C 1');
    expect(baselineRowsOf(root)).toEqual(['A 2 src/lib/x.ts', 'C 1 src/lib/y.ts']);
    expect(readFileSync(baselinePath(root), 'utf-8').startsWith(`${BASELINE_HEADER.join('\n')}\n`)).toBe(true);
  });

  it('(e) --update never adds a row and never raises one', () => {
    const root = makeTempGuard(['A 2 src/lib/x.ts']);

    const result = runGuard(root, ['A 5 src/lib/x.ts', 'B 1 src/lib/new.ts'], ['--update']);

    expect(result.ok).toBe(true);
    expect(baselineRowsOf(root)).toEqual(['A 2 src/lib/x.ts']);
    expect(runGuard(root, ['A 5 src/lib/x.ts', 'B 1 src/lib/new.ts']).ok).toBe(false);
  });

  it('(f) a missing baseline fails the check and is initialized by --update', () => {
    const root = makeTempGuard(null);
    const rows = ['B 1 src/lib/y.ts', 'A 2 src/lib/x.ts'];

    const check = runGuard(root, rows);
    expect(check.ok).toBe(false);
    expect(check.output).toContain('missing scripts/effect-facades-baseline.txt');
    expect(existsSync(baselinePath(root))).toBe(false);

    const init = runGuard(root, rows, ['--update']);
    expect(init.ok).toBe(true);
    expect(init.output).toContain('baseline initialized (A 2, B 1, C 0)');
    expect(baselineRowsOf(root)).toEqual(['A 2 src/lib/x.ts', 'B 1 src/lib/y.ts']);
    expect(runGuard(root, rows).ok).toBe(true);
  });
});
