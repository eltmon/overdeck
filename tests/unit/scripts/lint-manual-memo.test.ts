import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = new URL('../../../scripts/lint-manual-memo.sh', import.meta.url);
const BASELINE_HEADER = [
  '# Manual memo ratchet baseline (PAN-4561). Rows: <count> <path>.',
  '# Lower with: bash scripts/lint-manual-memo.sh --update',
];
const SRC = 'src/dashboard/frontend/src';

type GuardResult = { ok: boolean; output: string };

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function makeTempGuard(files: Record<string, string>, baselineRows: string[] | null): string {
  const root = mkdtempSync(join(tmpdir(), 'lint-manual-memo-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'lint-manual-memo.sh'), readFileSync(SCRIPT_SOURCE, 'utf-8'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  if (baselineRows) {
    writeFileSync(baselinePath(root), `${[...BASELINE_HEADER, ...baselineRows].join('\n')}\n`);
  }
  return root;
}

function baselinePath(root: string): string {
  return join(root, 'scripts', 'manual-memo-baseline.txt');
}

function baselineRowsOf(root: string): string[] {
  return readFileSync(baselinePath(root), 'utf-8').split('\n').filter((line) => line && !line.startsWith('#'));
}

function runGuard(root: string, args: string[] = []): GuardResult {
  try {
    const output = execFileSync('bash', [join(root, 'scripts', 'lint-manual-memo.sh'), ...args], {
      cwd: root,
      encoding: 'utf-8',
    });
    return { ok: true, output };
  } catch (error: unknown) {
    const result = error as { stdout?: string; stderr?: string };
    return { ok: false, output: [result.stdout ?? '', result.stderr ?? ''].join('\n') };
  }
}

const ONE_MEMO = "const value = useMemo(() => compute(a), [a]);\n";
const TWO_HOOKS = "const value = useMemo(() => compute(a), [a]);\nconst onClick = useCallback(() => run(a), [a]);\n";

describe('lint-manual-memo.sh', () => {
  it('passes when every count equals its baseline row', () => {
    const root = makeTempGuard({ [`${SRC}/a.tsx`]: TWO_HOOKS }, [`2 ${SRC}/a.tsx`]);

    const result = runGuard(root);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('✓ manual-memo ratchet passed (2 in 1 files; none new)');
  });

  it('fails and names the file when a new file has one useMemo(', () => {
    const root = makeTempGuard({ [`${SRC}/a.tsx`]: TWO_HOOKS, [`${SRC}/new.tsx`]: ONE_MEMO }, [`2 ${SRC}/a.tsx`]);

    const result = runGuard(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(`New useMemo/useCallback/memo in ${SRC}/new.tsx`);
    expect(result.output).toContain('see docs/DASHBOARD-ARCHITECTURE.md, React Compiler');
    expect(result.output).not.toContain(`${SRC}/a.tsx`);
  });

  it('fails when a file count rises above its row', () => {
    const root = makeTempGuard({ [`${SRC}/a.tsx`]: TWO_HOOKS }, [`1 ${SRC}/a.tsx`]);

    const result = runGuard(root);

    expect(result.ok).toBe(false);
    expect(result.output).toContain(`New useMemo/useCallback/memo in ${SRC}/a.tsx (2 call sites, baseline 1)`);
  });

  it('passes a lowered count, and --update lowers the row and drops resolved ones', () => {
    const root = makeTempGuard(
      { [`${SRC}/a.tsx`]: ONE_MEMO, [`${SRC}/b.tsx`]: 'export const b = 1;\n' },
      [`3 ${SRC}/a.tsx`, `2 ${SRC}/b.tsx`],
    );

    const check = runGuard(root);
    expect(check.ok).toBe(true);
    expect(check.output).toContain('2 baseline row(s) are above the current count');

    const update = runGuard(root, ['--update']);
    expect(update.ok).toBe(true);
    expect(baselineRowsOf(root)).toEqual([`1 ${SRC}/a.tsx`]);
  });

  it('--update never adds a row for an unbaselined file', () => {
    const root = makeTempGuard({ [`${SRC}/a.tsx`]: ONE_MEMO, [`${SRC}/new.tsx`]: ONE_MEMO }, [`1 ${SRC}/a.tsx`]);

    runGuard(root, ['--update']);

    expect(baselineRowsOf(root)).toEqual([`1 ${SRC}/a.tsx`]);
  });

  it('counts React.memo(, memo<Props>(, useCallback<T>( and React.useMemo(', () => {
    const source = [
      'export const A = React.memo(function A() { return null; });',
      'export const B = memo<Props>(function B() { return null; });',
      'const cb = useCallback<(n: number) => void>((n) => run(n), []);',
      'const v = React.useMemo(() => 1, []);',
      'const w = useMemo (() => 2, []); const x = useCallback(() => 3, []);',
      '',
    ].join('\n');
    const root = makeTempGuard({ [`${SRC}/count.tsx`]: source }, null);

    runGuard(root, ['--update']);

    expect(baselineRowsOf(root)).toEqual([`6 ${SRC}/count.tsx`]);
  });

  it('does not count comments, import specifiers, member calls, look-alikes or test files', () => {
    const source = [
      "import { memo, useCallback, useMemo } from 'react';",
      '// const v = useMemo(() => 1, []);',
      '  /* useCallback(() => 1, []) */',
      '   * memo(Component)',
      'const a = cache.memo(key);',
      'const b = memoize(fn);',
      'const c = useMemoizedValue(fn);',
      '',
    ].join('\n');
    const root = makeTempGuard(
      {
        [`${SRC}/clean.tsx`]: source,
        [`${SRC}/thing.test.tsx`]: ONE_MEMO,
        [`${SRC}/__tests__/thing.tsx`]: ONE_MEMO,
        [`${SRC}/test-utils/helper.tsx`]: ONE_MEMO,
        [`${SRC}/types.d.ts`]: ONE_MEMO,
      },
      null,
    );

    const init = runGuard(root, ['--update']);

    expect(init.output).toContain('✓ manual-memo baseline initialized (0 in 0 files)');
    expect(baselineRowsOf(root)).toEqual([]);
  });

  it('fails check mode when the baseline is missing and --update initializes it', () => {
    const root = makeTempGuard({ [`${SRC}/a.tsx`]: ONE_MEMO }, null);

    const check = runGuard(root);
    expect(check.ok).toBe(false);
    expect(check.output).toContain('missing scripts/manual-memo-baseline.txt');

    const init = runGuard(root, ['--update']);
    expect(init.ok).toBe(true);
    expect(baselineRowsOf(root)).toEqual([`1 ${SRC}/a.tsx`]);
  });
});
